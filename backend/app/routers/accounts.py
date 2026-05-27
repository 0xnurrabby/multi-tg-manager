from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
import asyncio

from ..db import get_db, AsyncSessionLocal
from ..models import Account, SecurityMessage, PendingLogin
from ..schemas import AccountOut, StatsOut, SendCodeIn, SignInIn
from ..tg_manager import manager

router = APIRouter(prefix="/api", tags=["accounts"])


async def _account_to_out(acc: Account, db: AsyncSession) -> AccountOut:
    unread = await db.scalar(
        select(func.count(SecurityMessage.id)).where(
            SecurityMessage.account_id == acc.id, SecurityMessage.is_read == False  # noqa: E712
        )
    )
    return AccountOut(
        id=acc.id,
        phone=acc.phone,
        tg_user_id=acc.tg_user_id,
        first_name=acc.first_name,
        last_name=acc.last_name,
        username=acc.username,
        bio=acc.bio,
        status=acc.status,
        has_2fa=acc.has_2fa,
        is_online=acc.is_online,
        last_seen=acc.last_seen,
        unread_security=unread or 0,
    )


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).order_by(Account.id))
    out = []
    for acc in res.scalars().all():
        out.append(await _account_to_out(acc, db))
    return out


@router.get("/accounts/{account_id}", response_model=AccountOut)
async def get_account(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    return await _account_to_out(acc, db)


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    await manager.remove_account(account_id)
    await db.delete(acc)
    await db.commit()
    return {"ok": True}


@router.get("/stats", response_model=StatsOut)
async def stats(db: AsyncSession = Depends(get_db)):
    total = await db.scalar(select(func.count(Account.id))) or 0
    connected = await db.scalar(select(func.count(Account.id)).where(Account.status == "connected")) or 0
    banned = await db.scalar(select(func.count(Account.id)).where(Account.status == "banned")) or 0
    with_2fa = await db.scalar(select(func.count(Account.id)).where(Account.has_2fa == True)) or 0  # noqa: E712
    unread = await db.scalar(select(func.count(SecurityMessage.id)).where(SecurityMessage.is_read == False)) or 0  # noqa: E712
    return StatsOut(total=total, connected=connected, banned=banned, with_2fa=with_2fa, unread_security=unread)


# ----- Auth -----
@router.post("/auth/send_code")
async def send_code(body: SendCodeIn):
    try:
        await asyncio.wait_for(manager.send_code(body.phone), timeout=45)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Telegram took too long to respond. Try again.")
    except Exception as e:
        raise HTTPException(400, f"send_code failed: {e}")
    return {"ok": True}


async def _persist_account(db: AsyncSession, phone: str, me) -> Account:
    res = await db.execute(select(Account).where(Account.phone == phone))
    acc = res.scalar_one_or_none()
    if not acc:
        acc = Account(
            phone=phone,
            tg_user_id=me.id,
            first_name=me.first_name or "",
            last_name=me.last_name or "",
            username=me.username or "",
            session_file=f"acc_{phone}",
            status="connected",
        )
        db.add(acc)
    else:
        acc.tg_user_id = me.id
        acc.first_name = me.first_name or ""
        acc.last_name = me.last_name or ""
        acc.username = me.username or ""
        acc.status = "connected"
    await db.commit()
    await db.refresh(acc)
    try:
        await manager.start_client(acc)
    except Exception:
        pass
    return acc


@router.post("/auth/sign_in")
async def sign_in(body: SignInIn, db: AsyncSession = Depends(get_db)):
    """Step 1: submit the SMS code. If 2FA is enabled, returns
    {"needs_2fa": true} with HTTP 200 (NOT 401, which would log the user out)."""
    try:
        me, needs_2fa = await asyncio.wait_for(
            manager.submit_code(body.phone, body.code), timeout=45
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Telegram took too long. Try again.")
    except Exception as e:
        raise HTTPException(400, f"sign_in failed: {e}")

    if needs_2fa:
        return {"needs_2fa": True}

    acc = await _persist_account(db, body.phone, me)
    out = await _account_to_out(acc, db)
    return {"needs_2fa": False, "account": out.model_dump(mode="json")}


@router.post("/auth/sign_in_2fa")
async def sign_in_2fa(body: SignInIn, db: AsyncSession = Depends(get_db)):
    """Step 2: submit 2FA password. Phone is the same one passed to /sign_in earlier."""
    if not body.password:
        raise HTTPException(400, "password required")
    try:
        me = await asyncio.wait_for(
            manager.submit_2fa(body.phone, body.password), timeout=45
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Telegram took too long. Try again.")
    except Exception as e:
        # Likely wrong password. Keep pending session alive so user can retry.
        msg = str(e)
        if "PASSWORD" in msg.upper() or "password" in msg:
            raise HTTPException(400, "Wrong 2FA password")
        raise HTTPException(400, f"2FA failed: {e}")

    acc = await _persist_account(db, body.phone, me)
    out = await _account_to_out(acc, db)
    return {"account": out.model_dump(mode="json")}


@router.post("/auth/cancel")
async def auth_cancel(body: SendCodeIn):
    await manager.cancel_pending(body.phone)
    return {"ok": True}
