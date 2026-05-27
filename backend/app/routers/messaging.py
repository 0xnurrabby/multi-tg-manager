from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.functions.messages import SendReactionRequest, GetMessagesViewsRequest
from telethon.tl.types import ReactionEmoji
import re

from ..db import get_db
from ..models import Account
from ..schemas import SendMessageIn, BulkMessageIn, ReactIn, ViewPostIn
from ..tg_manager import manager
from ..utils import jitter_delay, friendly_error

router = APIRouter(prefix="/api/messaging", tags=["messaging"])


def _parse_post_link(link: str) -> tuple[str, int]:
    # supports t.me/<username>/<id> and https://t.me/c/<channel_id>/<id>
    s = link.strip().replace("https://", "").replace("http://", "")
    if s.startswith("t.me/"):
        parts = s[5:].split("/")
        if len(parts) >= 2 and parts[0] == "c" and len(parts) >= 3:
            return parts[1], int(parts[2])  # numeric channel id
        if len(parts) >= 2:
            return parts[0], int(parts[1])
    raise ValueError("Invalid post link")


@router.post("/{account_id}/send")
async def send_message(account_id: int, body: SendMessageIn):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        await cli.send_message(body.target, body.text)
    except Exception as e:
        raise HTTPException(400, friendly_error(e))
    return {"ok": True}


@router.post("/bulk_send")
async def bulk_send(body: BulkMessageIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = res.scalars().all()
    success, failed, skipped = 0, 0, 0
    results = []
    for idx, acc in enumerate(accounts):
        cli = manager.get(acc.id)
        if not cli:
            skipped += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "skipped"})
            continue
        try:
            await cli.send_message(body.target, body.text)
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
        except Exception as e:
            failed += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
        if idx < len(accounts) - 1:
            await jitter_delay(3, 6)
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}


@router.post("/react")
async def react(body: ReactIn, db: AsyncSession = Depends(get_db)):
    try:
        chan, msg_id = _parse_post_link(body.post_link)
    except Exception as e:
        raise HTTPException(400, str(e))
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = res.scalars().all()
    success, failed, skipped = 0, 0, 0
    results = []
    for idx, acc in enumerate(accounts):
        cli = manager.get(acc.id)
        if not cli:
            skipped += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "skipped"})
            continue
        try:
            entity = await cli.get_entity(chan)
            await cli(SendReactionRequest(
                peer=entity, msg_id=msg_id,
                reaction=[ReactionEmoji(emoticon=body.emoji)],
            ))
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
        except Exception as e:
            failed += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
        if idx < len(accounts) - 1:
            await jitter_delay(2, 4)
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}


@router.post("/view")
async def view(body: ViewPostIn, db: AsyncSession = Depends(get_db)):
    try:
        chan, msg_id = _parse_post_link(body.post_link)
    except Exception as e:
        raise HTTPException(400, str(e))
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = res.scalars().all()
    success, failed, skipped = 0, 0, 0
    last_views = None
    results = []
    for idx, acc in enumerate(accounts):
        cli = manager.get(acc.id)
        if not cli:
            skipped += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "skipped"})
            continue
        try:
            entity = await cli.get_entity(chan)
            r = await cli(GetMessagesViewsRequest(peer=entity, id=[msg_id], increment=True))
            if r and r.views:
                last_views = r.views[0].views
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok", "views": last_views})
        except Exception as e:
            failed += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
        if idx < len(accounts) - 1:
            await jitter_delay(2, 4)
    return {"success": success, "failed": failed, "skipped": skipped, "results": results, "views": last_views}
