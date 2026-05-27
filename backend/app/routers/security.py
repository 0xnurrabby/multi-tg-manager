from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.functions.account import GetAuthorizationsRequest, ResetAuthorizationRequest
from datetime import datetime

from ..db import get_db
from ..models import SecurityMessage, Account
from ..schemas import SecurityMessageOut, TgSessionOut
from ..tg_manager import manager

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


@router.post("/messages/mark_all_read")
async def mark_all_read(account_id: int | None = None, db: AsyncSession = Depends(get_db)):
    q = update(SecurityMessage).values(is_read=True)
    if account_id is not None:
        q = q.where(SecurityMessage.account_id == account_id)
    await db.execute(q)
    await db.commit()
    return {"ok": True}


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
        res = await cli(GetAuthorizationsRequest())
        killed = 0
        for a in res.authorizations:
            if a.current:
                continue
            try:
                await cli(ResetAuthorizationRequest(hash=a.hash))
                killed += 1
            except Exception:
                pass
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "terminated": killed}
