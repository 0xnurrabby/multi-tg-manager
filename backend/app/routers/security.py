import re
import os
import asyncio
import time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.functions.account import (
    GetAuthorizationsRequest, ResetAuthorizationRequest, GetPasswordRequest,
    SendVerifyEmailCodeRequest, VerifyEmailRequest,
    GetAccountTTLRequest, SetAccountTTLRequest,
    SendConfirmPhoneCodeRequest, ConfirmPhoneRequest,
    UpdatePasswordSettingsRequest, ConfirmPasswordEmailRequest,
)
from telethon.tl.types import (
    AccountDaysTTL, CodeSettings, EmailVerifyPurposeLoginChange, EmailVerificationCode,
)
from telethon.tl.types import account as tg_account_types
from telethon.tl.types import auth as tg_auth_types
from telethon import password as pwd_mod
from telethon.errors import (
    EmailUnconfirmedError, FloodWaitError, PasswordHashInvalidError,
)
from datetime import datetime, timedelta

from .. import nurmail
from ..config import settings
from ..db import get_db, AsyncSessionLocal
from ..models import SecurityMessage, Account, AppSetting
from ..schemas import (
    SecurityMessageOut, TgSessionOut, Bulk2faIn, PressServiceButtonIn,
    EmailLoginSendIn, EmailLoginVerifyIn, AutoDeclineIn, AccountTtlIn, ResetCancelIn,
    RecoveryIn, RecoveryConfirmIn, AutoRecoveryIn, NurMailIn, Bulk2faOffIn, EmailAutoIn,
    LogoutAllIn,
)
from ..tg_manager import manager, record_gone_account
from .. import secrets_store
from ..utils import bulk_stream, friendly_error

router = APIRouter(prefix="/api/security", tags=["security"])


AUTO_DECLINE_KEY = "auto_decline_login"
REQUEST_TYPES = ("login_request", "new_login", "login_code", "account_deletion", "2fa_change")
RESET_LINK_RE = re.compile(r"https://t\.me/confirmphone\S+")
RESET_PHONE_RE = re.compile(r"[?&]phone=(\d+)")
RESET_HASH_RE = re.compile(r"[?&]hash=([A-Za-z0-9_-]+)")


def _reset_link_parts(text: str) -> tuple[str, str]:
    """Return (phone, hash) from a t.me/confirmphone link inside a message."""
    match = RESET_LINK_RE.search(text or "")
    if not match:
        return "", ""
    url = match.group(0)
    phone = RESET_PHONE_RE.search(url)
    hash_ = RESET_HASH_RE.search(url)
    return (phone.group(1) if phone else ""), (hash_.group(1) if hash_ else "")


async def _wait_for_app_code(account_id: int, since: datetime, timeout: int = 90) -> str:
    """Wait for the phone code Telegram sends as a 777000 service message."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        async with AsyncSessionLocal() as s:
            res = await s.execute(
                select(SecurityMessage.message_text)
                .where(
                    SecurityMessage.account_id == account_id,
                    SecurityMessage.received_at >= since,
                )
                .order_by(desc(SecurityMessage.received_at))
                .limit(6)
            )
            for (text,) in res.all():
                code = re.search(r"\b(\d{5})\b", text or "")
                if code:
                    return code.group(1)
        await asyncio.sleep(2)
    return ""


async def _auto_decline_enabled(db: AsyncSession) -> bool:
    row = await db.get(AppSetting, AUTO_DECLINE_KEY)
    return bool(row and row.value == "true")


@router.get("/login_requests")
async def login_requests(limit: int = 100, db: AsyncSession = Depends(get_db)):
    limit = max(1, min(int(limit or 100), 200))
    since = datetime.utcnow() - timedelta(days=7)
    res = await db.execute(
        select(SecurityMessage, Account)
        .join(Account, Account.id == SecurityMessage.account_id)
        .where(
            SecurityMessage.type.in_(REQUEST_TYPES),
            SecurityMessage.received_at >= since,
        )
        .order_by(desc(SecurityMessage.received_at))
        .limit(limit)
    )
    out = []
    for msg, acc in res.all():
        out.append({
            "id": msg.id,
            "account_id": msg.account_id,
            "account_name": (f"{acc.first_name or ''} {acc.last_name or ''}".strip() or acc.phone),
            "phone": acc.phone,
            "username": acc.username or "",
            "type": msg.type,
            "message_text": msg.message_text,
            "received_at": msg.received_at.isoformat() if msg.received_at else None,
            "is_read": bool(msg.is_read),
            "buttons": msg.buttons,
            "action_status": msg.action_status or "",
        })
    return out


@router.get("/reset_requests")
async def reset_requests(days: int = 8, db: AsyncSession = Depends(get_db)):
    """Every "Request to reset account" (7-day account deletion) message.

    Telegram sends these to all other sessions when someone starts the reset
    flow. They are pulled out of the normal message feed so they can't be missed.
    """
    window = max(1, min(int(days or 30), 120))
    since = datetime.utcnow() - timedelta(days=window)
    res = await db.execute(
        select(SecurityMessage, Account)
        .join(Account, Account.id == SecurityMessage.account_id)
        .where(SecurityMessage.received_at >= since)
        .order_by(desc(SecurityMessage.received_at))
        .limit(500)
    )
    now = datetime.utcnow()
    out = []
    for msg, acc in res.all():
        text = msg.message_text or ""
        low = text.lower()
        if not (
            "reset account" in low
            or "request to reset" in low
            or "cancel the deletion" in low
        ):
            continue
        cancel_url = ""
        match = RESET_LINK_RE.search(text)
        if match:
            cancel_url = match.group(0)
        if not cancel_url:
            for b in (msg.buttons or []):
                if b.get("type") == "url" and "confirmphone" in (b.get("url") or ""):
                    cancel_url = b["url"]
                    break
        days_left = None
        if msg.received_at:
            days_left = max(0, 7 - (now - msg.received_at).days)
        out.append({
            "id": msg.id,
            "account_id": msg.account_id,
            "account_name": (f"{acc.first_name or ''} {acc.last_name or ''}".strip() or acc.phone),
            "phone": acc.phone,
            "username": acc.username or "",
            "message_text": text,
            "received_at": msg.received_at.isoformat() if msg.received_at else None,
            "is_read": bool(msg.is_read),
            "days_left": days_left,
            "cancel_url": cancel_url,
            "action_status": msg.action_status or "",
        })
    out.sort(key=lambda r: (r["days_left"] if r["days_left"] is not None else 99))
    return out


_reset_hashes: dict[int, dict] = {}


@router.post("/reset_requests/{msg_id}/cancel")
async def cancel_reset_request(
    msg_id: int,
    body: ResetCancelIn | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Cancel a pending account deletion and log out whoever requested it.

    Telegram's flow: account.sendConfirmPhoneCode(hash) sends an SMS code, then
    account.confirmPhone(code) cancels the deletion. The SMS goes to the account's
    own number, so when the app cannot read it we keep the phone_code_hash and ask
    the user to paste the code from their number panel.
    """
    msg = await db.get(SecurityMessage, msg_id)
    if not msg:
        raise HTTPException(404, "Message not found")
    cli = manager.get(msg.account_id)
    if not cli:
        raise HTTPException(409, "Account is not connected")

    phone, hash_ = _reset_link_parts(msg.message_text or "")
    if not hash_:
        raise HTTPException(400, "This message has no cancel hash")
    if not phone:
        raise HTTPException(400, "This message has no phone number")

    code = ((body.code if body else "") or "").strip()
    stored = _reset_hashes.get(msg_id)
    phone_code_hash = ""
    if code and stored and stored.get("expires", 0) > time.time():
        phone_code_hash = stored["hash"]
    else:
        started = datetime.utcnow()
        try:
            sent = await cli(SendConfirmPhoneCodeRequest(
                hash=hash_, settings=CodeSettings(allow_app_hash=True),
            ))
        except FloodWaitError as e:
            raise HTTPException(429, f"Rate limited - wait {e.seconds}s") from None
        except Exception as e:
            raise HTTPException(400, _email_error_text(e)) from None
        phone_code_hash = sent.phone_code_hash
        _reset_hashes[msg_id] = {
            "hash": phone_code_hash,
            "expires": time.time() + 20 * 60,
        }
        if not code:
            if not isinstance(sent.type, tg_auth_types.SentCodeTypeApp):
                return {
                    "ok": False,
                    "need_code": True,
                    "sent_to": "sms",
                    "message": (
                        "Telegram sent the cancellation code by SMS to the account's "
                        "number. Get it from your number panel and paste it here."
                    ),
                }
            code = await _wait_for_app_code(msg.account_id, started, timeout=90)
            if not code:
                raise HTTPException(
                    408,
                    "No Telegram service message with the code arrived in 90s. "
                    "Try again, or paste the SMS code from your number panel.",
                )

    try:
        await cli(ConfirmPhoneRequest(phone_code_hash=phone_code_hash, phone_code=code))
    except FloodWaitError as e:
        raise HTTPException(429, f"Rate limited - wait {e.seconds}s") from None
    except Exception as e:
        raise HTTPException(400, _email_error_text(e) or friendly_error(e)) from None

    _reset_hashes.pop(msg_id, None)
    msg.action_status = "Deletion cancelled"
    msg.is_read = True
    await db.commit()
    return {"ok": True, "account_id": msg.account_id, "message": "Deletion cancelled"}


@router.post("/age/scan")
async def scan_account_age(limit: int = 0, db: AsyncSession = Depends(get_db)):
    """Guess each account's age from its oldest Telegram (777000) message.

    Telegram never exposes a registration date, but the first service message in
    the official Telegram chat is the closest real data we can read.
    """
    res = await db.execute(
        select(Account).where(Account.status != "banned").order_by(Account.id)
    )
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    if limit > 0:
        accounts = accounts[:limit]

    async def _one(cli, aid):
        first = None
        try:
            msgs = await cli.get_messages(777000, limit=1, reverse=True)
            if msgs:
                first = msgs[0]
        except Exception:
            first = None
        if first is None:
            try:
                msgs = await cli.get_messages(777000, limit=100)
                if msgs:
                    first = msgs[-1]
            except Exception:
                first = None
        if first is None or not getattr(first, "date", None):
            raise ValueError("no Telegram service messages")
        when = first.date.replace(tzinfo=None)
        async with AsyncSessionLocal() as s:
            acc = await s.get(Account, aid)
            if acc:
                acc.tg_since = when
                await s.commit()
        return "ok", when.strftime("%Y-%m-%d")

    return StreamingResponse(
        bulk_stream(accounts, _one, concurrency=8),
        media_type="application/x-ndjson",
    )


@router.get("/auto_decline")
async def get_auto_decline(db: AsyncSession = Depends(get_db)):
    return {"enabled": await _auto_decline_enabled(db)}


@router.put("/auto_decline")
async def set_auto_decline(body: AutoDeclineIn, db: AsyncSession = Depends(get_db)):
    row = await db.get(AppSetting, AUTO_DECLINE_KEY)
    value = "true" if body.enabled else "false"
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=AUTO_DECLINE_KEY, value=value))
    await db.commit()
    return {"enabled": bool(body.enabled)}


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


async def _set_account_2fa(account_id: int, value: bool) -> None:
    async with AsyncSessionLocal() as s:
        acc = await s.get(Account, account_id)
        if acc:
            acc.has_2fa = value
            await s.commit()


@router.post("/bulk_2fa_off")
async def bulk_2fa_off(body: Bulk2faOffIn, db: AsyncSession = Depends(get_db)):
    """Turn the Two-Step password OFF on many accounts at once.

    Needs each account's current password: the remembered one first, then the
    supplied bank (max 5 tries per account).
    """
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    phone_by_id = {a[0]: a[1] for a in accounts}
    bank = [p.strip() for p in (body.password_bank or []) if p and p.strip()]

    async def _off(cli, aid):
        phone = phone_by_id.get(aid, "")
        pw = await cli(GetPasswordRequest())
        if not getattr(pw, "has_password", False):
            await _set_account_2fa(aid, False)
            return "ok", "2FA already off"

        saved = await secrets_store.get_2fa(phone)
        candidates: list[str] = []
        for c in ([saved] if saved else []) + bank:
            if c and c not in candidates:
                candidates.append(c)
        candidates = candidates[:5]
        if not candidates:
            raise ValueError(
                "No current password known for this account. Add it to the password "
                "list above, or log in with it once."
            )

        for i, cand in enumerate(candidates, 1):
            try:
                await cli.edit_2fa(current_password=cand)
                await _set_account_2fa(aid, False)
                return "ok", f"2FA turned off (try {i})"
            except FloodWaitError:
                raise
            except Exception as e:
                if _is_wrong_password(e):
                    continue
                raise
        raise ValueError(f"None of your {len(candidates)} password(s) worked")

    return StreamingResponse(
        bulk_stream(accounts, _off, concurrency=6),
        media_type="application/x-ndjson",
    )


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
            "Telegram rejected this email. It may already be linked to another "
            "Telegram account, or this email/alias is not allowed. Try a "
            "different email address."
        )
    if "EMAIL_NOT_SETUP" in raw or "EMAIL_INSTALL_MISSING" in raw:
        return (
            "This account has no login email yet, and Telegram does not allow adding "
            "the first one through an API app. Telegram only offers login-email setup "
            "by itself, during a login. Accounts that already have a login email can "
            "still be changed here."
        )
    if "CODE_INVALID" in raw:
        return "That code is incorrect. Use the code sent to the new email."
    if "EMAIL_VERIFY_EXPIRED" in raw:
        return "The email verification code expired. Send a new code."
    if "EMAIL_INVALID" in raw:
        return "Telegram rejected this email address as invalid."
    if "PASSWORD_HASH_INVALID" in raw:
        return (
            "The saved 2FA password is wrong for this account. Update it with the "
            "bulk 2FA tool, then try again."
        )
    if "CODE_INVALID" in raw:
        return "That code is incorrect. Use the latest code from the mailbox."
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
    async with AsyncSessionLocal() as s:
        acc = await s.get(Account, account_id)
        if acc:
            acc.login_email_address = email.lower()
            await s.commit()
    return {
        "email": getattr(verified, "email", email),
        "login_email_pattern": pattern,
        "has_email": bool(pattern),
        "has_2fa": has_2fa,
        "checked_at": checked,
    }


RECOVERY_STATE_TTL = 15 * 60
_recovery_pending: dict[int, dict] = {}


async def _nurmail_settings(db: AsyncSession) -> tuple[str, str]:
    key_row = await db.get(AppSetting, "nurmail_api_key")
    url_row = await db.get(AppSetting, "nurmail_base_url")
    # A saved (even empty) row wins over .env, so "Remove key" really disables it.
    key = key_row.value if key_row else settings.NURMAIL_API_KEY
    base = url_row.value if url_row else settings.NURMAIL_BASE_URL
    return key or "", base or nurmail.DEFAULT_BASE_URL


async def _nurmail_client(db: AsyncSession) -> nurmail.NurMail:
    key, base = await _nurmail_settings(db)
    if not key:
        raise HTTPException(
            400,
            "NurMail API key is not set. Add it in Security → NurMail provider.",
        )
    return nurmail.NurMail(key, base)


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 12:
        return "set"
    return f"{key[:8]}…{key[-4:]}"


@router.get("/nurmail/config")
async def get_nurmail_config(db: AsyncSession = Depends(get_db)):
    key, base = await _nurmail_settings(db)
    key_row = await db.get(AppSetting, "nurmail_api_key")
    url_row = await db.get(AppSetting, "nurmail_base_url")
    return {
        "base_url": base,
        "key_set": bool(key),
        "key_hint": _mask_key(key),
        "from_env": not bool(key_row and key_row.value),
        "url_from_env": not bool(url_row and url_row.value),
    }


@router.put("/nurmail/config")
async def save_nurmail_config(body: NurMailIn, db: AsyncSession = Depends(get_db)):
    if body.clear:
        row = await db.get(AppSetting, "nurmail_api_key")
        if row:
            row.value = ""
        else:
            db.add(AppSetting(key="nurmail_api_key", value=""))
    elif body.api_key is not None and body.api_key.strip():
        value = body.api_key.strip()
        row = await db.get(AppSetting, "nurmail_api_key")
        if row:
            row.value = value
        else:
            db.add(AppSetting(key="nurmail_api_key", value=value))

    if body.base_url is not None:
        value = (body.base_url or "").strip() or nurmail.DEFAULT_BASE_URL
        row = await db.get(AppSetting, "nurmail_base_url")
        if row:
            row.value = value
        else:
            db.add(AppSetting(key="nurmail_base_url", value=value))

    await db.commit()
    key, base = await _nurmail_settings(db)
    return {
        "base_url": base,
        "key_set": bool(key),
        "key_hint": _mask_key(key),
        "from_env": False,
        "url_from_env": False,
    }


@router.post("/nurmail/test")
async def test_nurmail(db: AsyncSession = Depends(get_db)):
    client = await _nurmail_client(db)
    try:
        info = await asyncio.to_thread(client.me)
    except nurmail.NurMailError as e:
        raise HTTPException(400, str(e)) from None
    return {
        "ok": True,
        "name": info.get("name") or "",
        "domain": info.get("domain") or "",
        "mailboxes": info.get("mailboxCount") or 0,
        "remaining": info.get("remainingMailboxes") or 0,
    }


async def _apply_recovery_email(cli, password: str, email: str) -> bool:
    """Set the 2FA recovery email without touching the password itself.

    Returns False when Telegram wants the code from that mailbox confirmed.
    """
    last_error: Exception | None = None
    for attempt in range(2):
        pwd = await cli(GetPasswordRequest())
        if not getattr(pwd, "has_password", False):
            raise ValueError("This account has no 2FA password yet, so there is nothing to recover")
        pwd.new_algo.salt1 += os.urandom(32)
        check = pwd_mod.compute_check(pwd, password)
        try:
            await cli(UpdatePasswordSettingsRequest(
                password=check,
                new_settings=tg_account_types.PasswordInputSettings(email=email),
            ))
            return True
        except EmailUnconfirmedError:
            return False
        except Exception as e:
            last_error = e
            text = str(e).upper()
            # Telegram rotates the SRP challenge after security settings change
            # (for example right after a login-email edit); refetch and retry.
            if "SRP" in text and attempt < 1:
                await asyncio.sleep(2)
                continue
            raise
    if last_error:
        raise last_error
    return False


async def _save_recovery_email(account_id: int, email: str) -> None:
    if not email:
        return
    async with AsyncSessionLocal() as s:
        acc = await s.get(Account, account_id)
        if acc:
            acc.recovery_email = email.lower()
            await s.commit()


@router.get("/email/{account_id}/recovery")
async def recovery_status(account_id: int, db: AsyncSession = Depends(get_db)):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(400, "Account is not connected")
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    saved = await secrets_store.get_2fa(acc.phone)
    try:
        pwd = await cli(GetPasswordRequest())
    except Exception as e:
        raise HTTPException(400, friendly_error(e)) from None
    pending = _recovery_pending.get(account_id) or {}
    alive = bool(pending) and pending.get("expires", 0) > time.time()
    unconfirmed = getattr(pwd, "email_unconfirmed_pattern", "") or ""
    return {
        "has_2fa": bool(getattr(pwd, "has_password", False)),
        "password_known": bool(saved),
        "has_recovery": bool(getattr(pwd, "has_recovery", False)) or bool(unconfirmed),
        "recovery_email": acc.recovery_email or "",
        "unconfirmed_email": unconfirmed,
        "pending_email": pending.get("email", "") if alive else "",
    }


@router.post("/email/{account_id}/recovery")
async def set_recovery_email(
    account_id: int,
    body: RecoveryIn,
    db: AsyncSession = Depends(get_db),
):
    """Add (or replace) the 2FA recovery email on one account.

    With create_mailbox=True a new NurMail mailbox is created via the API and the
    verification code is read from it automatically. Otherwise the code goes to
    the address you entered (for example the same address as the login email) and
    has to be confirmed with /recovery/confirm.
    """
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(400, "Account is not connected")
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    password = await secrets_store.get_2fa(acc.phone)
    if not password:
        raise HTTPException(
            400,
            "The 2FA password for this account is not saved. Run the bulk 2FA tool "
            "or log in with it once, then try again.",
        )

    email = (body.email or "").strip().lower()
    created = False
    client = None
    if body.create_mailbox or not email:
        client = await _nurmail_client(db)
        try:
            box = await asyncio.to_thread(
                client.create_mailbox, (body.mailbox_name or "").strip() or None,
            )
        except nurmail.NurMailError as e:
            raise HTTPException(400, str(e)) from None
        email = str(box.get("address") or "").lower()
        created = True
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address")

    try:
        done = await _apply_recovery_email(cli, password, email)
    except FloodWaitError as e:
        raise HTTPException(429, f"Rate limited - wait {e.seconds}s") from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    except Exception as e:
        raise HTTPException(400, _email_error_text(e)) from None

    if done:
        await _save_recovery_email(account_id, email)
        return {"ok": True, "email": email, "created": created,
                "message": f"Recovery email set to {email}"}

    if created:
        try:
            code = await asyncio.to_thread(client.wait_otp, email)
            await cli(ConfirmPasswordEmailRequest(code=code))
            await _save_recovery_email(account_id, email)
            return {"ok": True, "email": email, "created": True,
                    "message": f"Recovery email set and confirmed: {email}"}
        except nurmail.NurMailError as e:
            raise HTTPException(
                400,
                f"The mailbox {email} was created but no code arrived ({e}). "
                "Press again to retry, or confirm the code manually.",
            ) from None
        except Exception as e:
            raise HTTPException(400, friendly_error(e)) from None

    # If the address belongs to this NurMail key, read the code automatically
    # instead of asking the user to paste it.
    readable = False
    try:
        client = client or await _nurmail_client(db)
        readable = await asyncio.to_thread(client.has_mailbox, email)
    except (nurmail.NurMailError, HTTPException):
        readable = False
    if readable:
        try:
            code = await asyncio.to_thread(client.wait_otp, email)
            await cli(ConfirmPasswordEmailRequest(code=code))
            await _save_recovery_email(account_id, email)
            return {"ok": True, "email": email, "created": False,
                    "message": f"Recovery email set and confirmed: {email}"}
        except Exception:
            pass  # fall through to the manual code step

    _recovery_pending[account_id] = {
        "email": email,
        "expires": time.time() + RECOVERY_STATE_TTL,
    }
    return {
        "ok": False,
        "need_code": True,
        "email": email,
        "created": False,
        "message": f"Telegram sent a code to {email}. Get it from that mailbox and confirm.",
    }


@router.post("/email/{account_id}/recovery/confirm")
async def confirm_recovery_email(account_id: int, body: RecoveryConfirmIn):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(400, "Account is not connected")
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(400, "Enter the code from the email")
    try:
        await cli(ConfirmPasswordEmailRequest(code=code))
    except FloodWaitError as e:
        raise HTTPException(429, f"Rate limited - wait {e.seconds}s") from None
    except Exception as e:
        raise HTTPException(400, _email_error_text(e)) from None
    pending = _recovery_pending.pop(account_id, None)
    if pending and pending.get("email"):
        await _save_recovery_email(account_id, pending["email"])
    return {"ok": True, "message": "Recovery email confirmed"}


@router.post("/email/auto")
async def auto_email_setup(body: EmailAutoIn, db: AsyncSession = Depends(get_db)):
    """Set the login email and the 2FA recovery email together, one run.

    Per account: keep a known login email when the provider owns it; otherwise
    create a mailbox and switch the login email to it. The recovery email uses
    the same address (a fresh one is generated only when that is not possible).
    """
    client = await _nurmail_client(db)
    if not body.login and not body.recovery:
        raise HTTPException(400, "Pick login email, recovery email, or both")
    conc = max(1, min(int(body.concurrency or 5), 10))

    q = select(Account).where(Account.status != "banned").order_by(Account.id)
    if body.account_ids:
        q = q.where(Account.id.in_(body.account_ids))
    res = await db.execute(q)
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]

    async def _new_mailbox() -> str:
        box = await asyncio.to_thread(client.create_mailbox)
        return str(box.get("address") or "").lower()

    async def _save_login(aid: int, email: str) -> None:
        async with AsyncSessionLocal() as s:
            acc = await s.get(Account, aid)
            if acc:
                acc.login_email_address = email
                await s.commit()

    async def _run(cli, aid):
        async with AsyncSessionLocal() as s:
            acc = await s.get(Account, aid)
            if not acc:
                raise ValueError("account not found")
            phone = acc.phone
            known = (acc.login_email_address or "").strip().lower()
            pattern = (acc.login_email_pattern or "").strip()

        password = ""
        if body.recovery:
            password = await secrets_store.get_2fa(phone)
            if not password:
                raise ValueError("2FA password not saved for this account")

        parts: list[str] = []
        target = ""
        if known:
            try:
                if await asyncio.to_thread(client.has_mailbox, known):
                    target = known
            except nurmail.NurMailError:
                target = ""
        if not target and (body.recovery or body.login):
            target = await _new_mailbox()

        # Recovery first: changing the login email rotates Telegram's SRP
        # challenge, which would make the immediate password-settings call fail.
        if body.recovery:
            email = target
            try:
                since = await asyncio.to_thread(client.latest_message_id, email)
                done = await _apply_recovery_email(cli, password, email)
                if not done:
                    code = await asyncio.to_thread(client.wait_otp, email, 15, 75, since)
                    await cli(ConfirmPasswordEmailRequest(code=code))
                await _save_recovery_email(aid, email)
                parts.append(f"recovery → {email}")
            except Exception as e:
                last = str(e)[:120]
                # one fallback with a fresh mailbox
                email = await _new_mailbox()
                since = await asyncio.to_thread(client.latest_message_id, email)
                done = await _apply_recovery_email(cli, password, email)
                if not done:
                    code = await asyncio.to_thread(client.wait_otp, email, 15, 75, since)
                    await cli(ConfirmPasswordEmailRequest(code=code))
                await _save_recovery_email(aid, email)
                parts.append(f"recovery → {email} (fallback after {last})")
                target = email

        if body.login:
            if not pattern:
                parts.append("login: Telegram does not allow the first login email")
            elif known and target == known:
                parts.append(f"login already {known}")
            else:
                addr = target
                try:
                    since = await asyncio.to_thread(client.latest_message_id, addr)
                    await cli(SendVerifyEmailCodeRequest(
                        EmailVerifyPurposeLoginChange(), addr,
                    ))
                    code = await asyncio.to_thread(client.wait_otp, addr, 15, 75, since)
                    await cli(VerifyEmailRequest(
                        EmailVerifyPurposeLoginChange(), EmailVerificationCode(code),
                    ))
                    await _refresh_email_status(cli, aid)
                    await _save_login(aid, addr)
                    parts.append(f"login → {addr}")
                except Exception as e:
                    parts.append(f"login failed: {str(e)[:120]}")

        if not parts:
            return "skipped", "nothing to do"
        return "ok", " · ".join(parts)

    return StreamingResponse(
        bulk_stream(accounts, _run, concurrency=conc),
        media_type="application/x-ndjson",
    )


@router.post("/recovery/auto")
async def auto_recovery(body: AutoRecoveryIn, db: AsyncSession = Depends(get_db)):
    """Add a 2FA recovery email to many accounts at once.

    For each account: use the known login email if the NurMail provider owns it,
    otherwise create a fresh mailbox. If the first mailbox fails, try another one.
    """
    client = await _nurmail_client(db)
    conc = max(1, min(int(body.concurrency or 5), 10))
    provider_domain = "nurmail.fun"
    try:
        info = await asyncio.to_thread(client.me)
        provider_domain = (info.get("domain") or provider_domain).strip().lower()
    except nurmail.NurMailError:
        pass

    q = select(Account).where(Account.status != "banned").order_by(Account.id)
    if body.account_ids:
        q = q.where(Account.id.in_(body.account_ids))
    res = await db.execute(q)
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]

    async def _new_mailbox() -> str:
        box = await asyncio.to_thread(client.create_mailbox)
        return str(box.get("address") or "").lower()

    async def _confirm(cli, password: str, email: str):
        since = await asyncio.to_thread(client.latest_message_id, email)
        done = await _apply_recovery_email(cli, password, email)
        if not done:
            code = await asyncio.to_thread(client.wait_otp, email, 15, 75, since)
            await cli(ConfirmPasswordEmailRequest(code=code))

    async def _run(cli, aid):
        async with AsyncSessionLocal() as s:
            acc = await s.get(Account, aid)
            if not acc:
                raise ValueError("account not found")
            phone = acc.phone
            known = (acc.login_email_address or "").strip().lower()
            stored_recovery = (acc.recovery_email or "").strip().lower()
        # Accounts that already have a recovery email on this provider are left alone.
        if stored_recovery and stored_recovery.endswith("@" + provider_domain):
            return "skipped", f"already has {stored_recovery}"
        password = await secrets_store.get_2fa(phone)
        if not password:
            raise ValueError("2FA password not saved for this account")

        email = ""
        if known:
            try:
                if await asyncio.to_thread(client.has_mailbox, known):
                    email = known
            except nurmail.NurMailError:
                email = ""

        if email:
            try:
                await _confirm(cli, password, email)
                await _save_recovery_email(aid, email)
                return "ok", email
            except Exception as e:
                first_error = str(e)[:120]
        else:
            first_error = "login email is not on the NurMail provider"

        # Fall back to a freshly generated mailbox, twice if needed.
        last_error = first_error
        for _ in range(2):
            try:
                new_email = await _new_mailbox()
            except nurmail.NurMailError as e:
                raise ValueError(f"mailbox create failed: {e}")
            try:
                await _confirm(cli, password, new_email)
                await _save_recovery_email(aid, new_email)
                return "ok", new_email
            except Exception as e:
                last_error = str(e)[:120]
        raise ValueError(last_error or "could not add a recovery email")

    return StreamingResponse(
        bulk_stream(accounts, _run, concurrency=conc),
        media_type="application/x-ndjson",
    )


ACCOUNT_TTL_CHOICES = (30, 90, 180, 365, 548, 730)


def _ttl_rows(rows) -> list[tuple[int, str, str]]:
    return [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in rows
    ]


@router.post("/ttl/scan")
async def scan_account_ttl(db: AsyncSession = Depends(get_db)):
    """Read the "If away for" (account self-destruct) value of every account."""
    res = await db.execute(
        select(Account).where(Account.status != "banned").order_by(Account.id)
    )
    accounts = _ttl_rows(res.scalars().all())

    async def _check(cli, _aid):
        ttl = await cli(GetAccountTTLRequest())
        days = int(getattr(ttl, "days", 0) or 0)
        return "ok", f"{days} days"

    return StreamingResponse(
        bulk_stream(accounts, _check, concurrency=8),
        media_type="application/x-ndjson",
    )


@router.post("/ttl/set")
async def set_account_ttl(body: AccountTtlIn, db: AsyncSession = Depends(get_db)):
    """Set the "If away for" value on many accounts at once.

    Telegram only accepts 30, 90, 180, 365, 548 (18 months) or 730 (24 months) days.
    """
    days = int(body.days or 0)
    if days not in ACCOUNT_TTL_CHOICES:
        raise HTTPException(400, "Choose 30, 90, 180, 365, 548 or 730 days")

    q = select(Account).where(Account.status != "banned").order_by(Account.id)
    if body.account_ids:
        q = q.where(Account.id.in_(body.account_ids))
    res = await db.execute(q)
    accounts = _ttl_rows(res.scalars().all())

    async def _set(cli, _aid):
        await cli(SetAccountTTLRequest(AccountDaysTTL(days=days)))
        return "ok", f"{days} days"

    return StreamingResponse(
        bulk_stream(accounts, _set, concurrency=6),
        media_type="application/x-ndjson",
    )




async def _forget_account(account_id: int, db: AsyncSession) -> None:
    """Remove the account from the manager (session file + DB row)."""
    acc = await db.get(Account, account_id)
    if not acc:
        return
    try:
        if acc.status != "banned":
            await record_gone_account(db, acc, "removed")
    except Exception:
        pass
    try:
        await manager.remove_account_instance(acc)
    except Exception:
        pass
    await db.delete(acc)
    await db.commit()

@router.post("/sessions/{account_id}/logout_self")
async def logout_self_session(account_id: int, db: AsyncSession = Depends(get_db)):
    """Log this app's session out, leaving every other device alone."""
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account is not connected")
    try:
        await cli.log_out()
    except Exception as e:
        raise HTTPException(400, friendly_error(e)) from None
    await _forget_account(account_id, db)
    return {"ok": True, "removed": True}


@router.post("/sessions/{account_id}/logout_all")
async def logout_all_sessions(
    account_id: int,
    body: LogoutAllIn | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Remove every Telegram session on this account, optionally keeping one.

    Built for selling: after the buyer bot logs in, keep that session and drop
    everything else (including this app), so no other device stays attached.
    """
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account is not connected")

    res = await cli(GetAuthorizationsRequest())
    current = next((a for a in res.authorizations if a.current), None)
    others = [a for a in res.authorizations if not a.current]

    # The newest non-current session is the buyer (last login). It is never
    # logged out here, whatever the client sends.
    keep = max(others, key=lambda a: a.date_created or 0).hash if others else None

    terminated = 0
    failed = 0
    for a in res.authorizations:
        if keep is not None and a.hash == keep:
            continue
        if a.current:
            continue  # handled with log_out below
        try:
            await cli(ResetAuthorizationRequest(hash=a.hash))
            terminated += 1
        except Exception:
            failed += 1

    self_dropped = False
    if keep is None or current is None or current.hash != keep:
        try:
            await cli.log_out()
            self_dropped = True
        except Exception:
            pass
        await _forget_account(account_id, db)

    return {
        "ok": True,
        "kept_hash": keep,
        "terminated": terminated,
        "failed": failed,
        "self_logged_out": self_dropped,
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
