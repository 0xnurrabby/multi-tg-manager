import re
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.functions.account import (
    GetAuthorizationsRequest, ResetAuthorizationRequest, GetPasswordRequest,
    SendVerifyEmailCodeRequest, VerifyEmailRequest,
)
from telethon.tl.types import EmailVerifyPurposeLoginChange, EmailVerificationCode
from telethon.errors import FloodWaitError, PasswordHashInvalidError
from datetime import datetime

from ..db import get_db, AsyncSessionLocal
from ..models import SecurityMessage, Account
from ..schemas import (
    SecurityMessageOut, TgSessionOut, Bulk2faIn, PressServiceButtonIn,
    EmailLoginSendIn, EmailLoginVerifyIn,
)
from ..tg_manager import manager
from .. import secrets_store
from ..utils import bulk_stream, friendly_error

router = APIRouter(prefix="/api/security", tags=["security"])


@router.get("/messages", response_model=list[SecurityMessageOut])
async def list_messages(account_id: int | None = None, only_unread: bool = False, db: AsyncSession = Depends(get_db)):
    q = select(SecurityMessage).order_by(desc(SecurityMessage.received_at)).limit(500)
    if account_id is not None:
        q = q.where(SecurityMessage.account_id == account_id)
    if only_unread:
        q = q.where(SecurityMessage.is_read == False)  # noqa: E712
    res = await db.execute(q)
    return list(res.scalars().all())


@router.post("/messages/{msg_id}/read")
async def mark_read(msg_id: int, db: AsyncSession = Depends(get_db)):
    m = await db.get(SecurityMessage, msg_id)
    if not m:
        raise HTTPException(404, "Not found")
    m.is_read = True
    await db.commit()
    return {"ok": True}


@router.post("/messages/{msg_id}/press")
async def press_button(msg_id: int, body: PressServiceButtonIn, db: AsyncSession = Depends(get_db)):
    """Press a callback button (e.g. Confirm/Decline on a login approval)."""
    m = await db.get(SecurityMessage, msg_id)
    if not m:
        raise HTTPException(404, "Not found")
    btn = next((b for b in m.buttons if b.get("index") == body.index), None)
    if not btn:
        raise HTTPException(400, "That button is no longer available")
    if btn.get("type") != "callback":
        raise HTTPException(400, "This button cannot be pressed from here")
    cli = manager.get(m.account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        answer = await manager.press_service_button(
            m.account_id, m.tg_msg_id, body.index, btn.get("data"),
        )
    except Exception as e:
        raise HTTPException(400, str(e) or e.__class__.__name__)
    m.action_status = btn.get("text") or "pressed"
    m.is_read = True
    await db.commit()
    return {"ok": True, "answer": answer, "action_status": m.action_status}


@router.post("/messages/mark_all_read")
async def mark_all_read(account_id: int | None = None, db: AsyncSession = Depends(get_db)):
    q = update(SecurityMessage).values(is_read=True)
    if account_id is not None:
        q = q.where(SecurityMessage.account_id == account_id)
    await db.execute(q)
    await db.commit()
    return {"ok": True}


@router.post("/messages/{account_id}/backfill")
async def backfill(account_id: int, limit: int = 50):
    """Pull recent messages from 777000 for this account.
    Useful after first login (to see history) or when listener missed something."""
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        await manager._backfill_777000(account_id, cli, limit=min(max(limit, 1), 200))
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.get("/twofa_known")
async def twofa_known():
    """How many saved 2FA passwords we have locally (used to seed bulk change)."""
    try:
        return {"count": await secrets_store.count()}
    except Exception:
        return {"count": 0}


def _is_wrong_password(e: Exception) -> bool:
    if isinstance(e, PasswordHashInvalidError):
        return True
    return "PASSWORD_HASH_INVALID" in str(e).upper()


@router.post("/bulk_2fa")
async def bulk_2fa(body: Bulk2faIn, db: AsyncSession = Depends(get_db)):
    """Change (or set) the Two-Step password on many accounts at once.

    For accounts that already have 2FA, the current password is required: we try
    each account's remembered password first, then up to the provided bank — at
    most 5 attempts per account — until one is accepted, then set the new one.
    """
    new_password = (body.new_password or "").strip()
    if not new_password:
        raise HTTPException(400, "New password is required")
    hint = (body.hint or "")[:20]

    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    phone_by_id = {a[0]: a[1] for a in accounts}
    bank = [p.strip() for p in (body.password_bank or []) if p and p.strip()]

    async def _set_has_2fa(account_id: int):
        async with AsyncSessionLocal() as s:
            acc = await s.get(Account, account_id)
            if acc:
                acc.has_2fa = True
                await s.commit()

    async def _save_warn(phone: str) -> str:
        """Persist the new password, but never let a save failure mask the fact
        that Telegram already accepted the change. Returns a warning suffix."""
        try:
            await secrets_store.save_2fa(phone, new_password)
            return ""
        except Exception:
            return " — note: password changed but couldn't be saved locally"

    async def _change(cli, aid):
        phone = phone_by_id.get(aid, "")
        pw = await cli(GetPasswordRequest())
        # Account has no 2FA yet -> just set the new password (no current needed).
        if not pw.has_password:
            await cli.edit_2fa(new_password=new_password, hint=hint)
            warn = await _save_warn(phone)
            await _set_has_2fa(aid)
            return "ok", "2FA set (was off)" + warn

        # Build the candidate bank: remembered password first, then provided ones.
        saved = await secrets_store.get_2fa(phone)
        candidates: list[str] = []
        for c in ([saved] if saved else []) + bank:
            if c and c not in candidates:
                candidates.append(c)
        candidates = candidates[:5]  # max 5 tries per account
        if not candidates:
            raise ValueError(
                "No current password known for this account. Either log in with it "
                "first (so we remember its password), or add the current password to the list above."
            )

        tried = 0
        for cand in candidates:
            tried += 1
            try:
                await cli.edit_2fa(current_password=cand, new_password=new_password, hint=hint)
                warn = await _save_warn(phone)
                await _set_has_2fa(aid)
                return "ok", f"changed (try {tried})" + warn
            except FloodWaitError:
                raise  # surfaced as a clear "wait Ns" message; don't keep hammering
            except Exception as e:
                if _is_wrong_password(e):
                    continue  # try the next candidate
                raise
        raise ValueError(f"None of your {tried} current password(s) worked for this account")

    return StreamingResponse(bulk_stream(accounts, _change), media_type="application/x-ndjson")


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email_error_text(e: Exception) -> str:
    raw = str(e).upper()
    if "EMAIL_NOT_ALLOWED" in raw:
        return (
            "Telegram rejected this email address. Use a normal email (Gmail, "
            "Outlook, or a real domain), not a temporary or disposable one."
        )
    if "EMAIL_NOT_SETUP" in raw:
        return (
            "This account has no login email yet. Telegram requires setting "
            "one in the Telegram app before it can be changed."
        )
    if "CODE_INVALID" in raw:
        return "That code is incorrect. Use the code sent to the new email."
    if "EMAIL_VERIFY_EXPIRED" in raw:
        return "The email verification code expired. Send a new code."
    if "EMAIL_INVALID" in raw:
        return "Telegram rejected this email address as invalid."
    return friendly_error(e)


async def _refresh_email_status(cli, account_id: int):
    pw = await cli(GetPasswordRequest())
    pattern = (getattr(pw, "login_email_pattern", "") or "").strip()
    has_2fa = bool(getattr(pw, "has_password", False))
    checked = datetime.utcnow()
    async with AsyncSessionLocal() as s:
        acc = await s.get(Account, account_id)
        if acc:
            acc.login_email_pattern = pattern
            acc.has_2fa = has_2fa
            acc.email_checked_at = checked
            await s.commit()
    return pattern, has_2fa, checked


@router.post("/email/scan")
async def scan_login_emails(db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Account).where(Account.status != "banned").order_by(Account.id)
    )
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]

    async def _check(cli, aid):
        pattern, has_2fa, _ = await _refresh_email_status(cli, aid)
        email = pattern or "no email"
        return "ok", f"{email} - 2FA {'on' if has_2fa else 'off'}"

    return StreamingResponse(
        bulk_stream(accounts, _check, concurrency=8),
        media_type="application/x-ndjson",
    )


@router.post("/email/{account_id}/check")
async def check_login_email(account_id: int):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(400, "Account is not connected")
    try:
        pattern, has_2fa, checked = await _refresh_email_status(cli, account_id)
    except FloodWaitError as e:
        raise HTTPException(429, f"Rate limited - wait {e.seconds}s") from None
    except Exception as e:
        raise HTTPException(400, friendly_error(e)) from None
    return {
        "login_email_pattern": pattern,
        "has_email": bool(pattern),
        "has_2fa": has_2fa,
        "checked_at": checked,
    }


@router.post("/email/{account_id}/send_code")
async def send_login_email_code(account_id: int, body: EmailLoginSendIn):
    email = (body.email or "").strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address")
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(400, "Account is not connected")
    try:
        sent = await cli(SendVerifyEmailCodeRequest(
            EmailVerifyPurposeLoginChange(), email,
        ))
    except FloodWaitError as e:
        raise HTTPException(429, f"Rate limited - wait {e.seconds}s") from None
    except Exception as e:
        raise HTTPException(400, _email_error_text(e)) from None
    return {
        "email": email,
        "email_pattern": sent.email_pattern,
        "length": sent.length,
    }


@router.post("/email/{account_id}/verify")
async def verify_login_email_code(account_id: int, body: EmailLoginVerifyIn):
    email = (body.email or "").strip()
    code = (body.code or "").strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address")
    if not code:
        raise HTTPException(400, "Enter the code from the new email")
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(400, "Account is not connected")
    try:
        verified = await cli(VerifyEmailRequest(
            EmailVerifyPurposeLoginChange(), EmailVerificationCode(code),
        ))
    except FloodWaitError as e:
        raise HTTPException(429, f"Rate limited - wait {e.seconds}s") from None
    except Exception as e:
        raise HTTPException(400, _email_error_text(e)) from None
    try:
        pattern, has_2fa, checked = await _refresh_email_status(cli, account_id)
    except Exception:
        pattern, has_2fa, checked = email, False, datetime.utcnow()
    return {
        "email": getattr(verified, "email", email),
        "login_email_pattern": pattern,
        "has_email": bool(pattern),
        "has_2fa": has_2fa,
        "checked_at": checked,
    }


async def _terminate_other_authorizations(cli) -> tuple[int, int]:
    res = await cli(GetAuthorizationsRequest())
    killed = 0
    failed = 0
    for a in res.authorizations:
        if a.current:
            continue
        try:
            await cli(ResetAuthorizationRequest(hash=a.hash))
            killed += 1
        except Exception:
            failed += 1
    return killed, failed


@router.post("/sessions/terminate_others_all")
async def terminate_others_all(db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Account).where(Account.status != "banned").order_by(Account.id)
    )
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]

    async def _terminate(cli, aid):
        killed, failed = await _terminate_other_authorizations(cli)
        detail = "no other sessions" if killed == 0 else f"terminated {killed}"
        if failed:
            detail += f", {failed} failed"
        return "ok", detail

    return StreamingResponse(
        bulk_stream(accounts, _terminate),
        media_type="application/x-ndjson",
    )


@router.get("/sessions/{account_id}", response_model=list[TgSessionOut])
async def list_sessions(account_id: int):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    res = await cli(GetAuthorizationsRequest())
    out = []
    for a in res.authorizations:
        out.append(TgSessionOut(
            hash=a.hash,
            device=a.device_model or "",
            platform=a.platform or "",
            app_name=a.app_name or "",
            ip=a.ip or "",
            country=a.country or "",
            date_created=a.date_created,
            is_current=a.current,
        ))
    return out


@router.delete("/sessions/{account_id}/{hash_id}")
async def terminate_session(account_id: int, hash_id: int):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        await cli(ResetAuthorizationRequest(hash=hash_id))
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/sessions/{account_id}/terminate_others")
async def terminate_others(account_id: int):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        killed, _failed = await _terminate_other_authorizations(cli)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "terminated": killed}
