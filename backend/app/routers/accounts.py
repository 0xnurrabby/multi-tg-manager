from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

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
async def send_code(body: SendCodeIn, db: AsyncSession = Depends(get_db)):
    try:
        phone_code_hash = await manager.send_code(body.phone)
    except Exception as e:
        raise HTTPException(400, f"send_code failed: {e}")
    pl = await db.get(PendingLogin, body.phone)
    if pl:
        pl.phone_code_hash = phone_code_hash
        pl.created_at = datetime.utcnow()
    else:
        db.add(PendingLogin(phone=body.phone, phone_code_hash=phone_code_hash))
    await db.commit()
    return {"ok": True}


@router.post("/auth/sign_in", response_model=AccountOut)
async def sign_in(body: SignInIn, db: AsyncSession = Depends(get_db)):
    pl = await db.get(PendingLogin, body.phone)
    if not pl:
        raise HTTPException(400, "No pending login. Call send_code first.")
    try:
        me = await manager.sign_in(body.phone, body.code, pl.phone_code_hash, body.password)
    except Exception as e:
        from telethon.errors import SessionPasswordNeededError
        if isinstance(e, SessionPasswordNeededError):
            raise HTTPException(401, "2FA password required")
        raise HTTPException(400, f"sign_in failed: {e}")

    res = await db.execute(select(Account).where(Account.phone == body.phone))
    acc = res.scalar_one_or_none()
    if not acc:
        acc = Account(
            phone=body.phone,
            tg_user_id=me.id,
            first_name=me.first_name or "",
            last_name=me.last_name or "",
            username=me.username or "",
            session_file=f"acc_{body.phone}",
            status="connected",
        )
        db.add(acc)
    else:
        acc.tg_user_id = me.id
        acc.first_name = me.first_name or ""
        acc.last_name = me.last_name or ""
        acc.username = me.username or ""
        acc.status = "connected"
    await db.delete(pl)
    await db.commit()
    await db.refresh(acc)

    try:
        await manager.start_client(acc)
    except Exception:
        pass

    return await _account_to_out(acc, db)
