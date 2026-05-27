from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.types import Channel, Chat, ChatForbidden, ChannelForbidden
from telethon.tl.functions.channels import JoinChannelRequest, LeaveChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest, CheckChatInviteRequest
from telethon.errors import FloodWaitError, UserAlreadyParticipantError, InviteHashExpiredError
from time import time

from ..db import get_db
from ..models import Account
from ..schemas import JoinIn, BulkJoinIn, GroupOut, LeaveIn, BulkLeaveIn
from ..tg_manager import manager
from ..utils import jitter_delay, friendly_error

router = APIRouter(prefix="/api/groups", tags=["groups"])

# crude 5-min cache: account_id -> (ts, list)
_cache: dict[int, tuple[float, list[dict]]] = {}
CACHE_TTL = 300


def _parse_invite(target: str) -> tuple[str, str | None]:
    """Return (kind, payload). kind in {'username','invite'}."""
    t = target.strip()
    if t.startswith("https://t.me/+") or t.startswith("t.me/+") or t.startswith("https://t.me/joinchat/"):
        # invite link
        payload = t.split("/")[-1].lstrip("+")
        return "invite", payload
    if t.startswith("https://t.me/") or t.startswith("t.me/"):
        u = t.split("/")[-1].lstrip("@")
        return "username", u
    if t.startswith("@"):
        return "username", t[1:]
    return "username", t


async def _join_with_client(cli, target: str):
    kind, payload = _parse_invite(target)
    if kind == "invite":
        return await cli(ImportChatInviteRequest(payload))
    return await cli(JoinChannelRequest(payload))


@router.post("/{account_id}/join")
async def join_one(account_id: int, body: JoinIn):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        await _join_with_client(cli, body.target)
        _cache.pop(account_id, None)
    except UserAlreadyParticipantError:
        return {"ok": True, "detail": "already a participant"}
    except FloodWaitError as e:
        raise HTTPException(429, f"FloodWait: {e.seconds}s")
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/bulk_join")
async def bulk_join(body: BulkJoinIn, db: AsyncSession = Depends(get_db)):
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
            await _join_with_client(cli, body.target)
            _cache.pop(acc.id, None)
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
        except UserAlreadyParticipantError:
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok", "detail": "already in"})
        except Exception as e:
            failed += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
        if idx < len(accounts) - 1:
            await jitter_delay(3, 5)
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}


@router.get("/{account_id}/list", response_model=list[GroupOut])
async def list_groups(account_id: int):
    now = time()
    hit = _cache.get(account_id)
    if hit and (now - hit[0]) < CACHE_TTL:
        return hit[1]
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    out: list[dict] = []
    async for dialog in cli.iter_dialogs():
        e = dialog.entity
        if isinstance(e, (Chat, ChatForbidden)):
            out.append({
                "id": int(e.id),
                "title": getattr(e, "title", "") or "",
                "username": None,
                "type": "group",
                "members": getattr(e, "participants_count", None),
                "invite_link": None,
            })
        elif isinstance(e, (Channel, ChannelForbidden)):
            is_megagroup = getattr(e, "megagroup", False)
            out.append({
                "id": int(e.id),
                "title": getattr(e, "title", "") or "",
                "username": getattr(e, "username", None),
                "type": "supergroup" if is_megagroup else "channel",
                "members": getattr(e, "participants_count", None),
                "invite_link": f"https://t.me/{e.username}" if getattr(e, "username", None) else None,
            })
    _cache[account_id] = (now, out)
    return out


@router.post("/{account_id}/leave")
async def leave_one(account_id: int, body: LeaveIn):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        entity = await cli.get_entity(body.chat_id)
        if isinstance(entity, (Channel, ChannelForbidden)):
            await cli(LeaveChannelRequest(entity))
        else:
            await cli.delete_dialog(entity)
        _cache.pop(account_id, None)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/bulk_leave")
async def bulk_leave(body: BulkLeaveIn, db: AsyncSession = Depends(get_db)):
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
            entity = await cli.get_entity(body.chat_id)
            if isinstance(entity, (Channel, ChannelForbidden)):
                await cli(LeaveChannelRequest(entity))
            else:
                await cli.delete_dialog(entity)
            _cache.pop(acc.id, None)
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
        except Exception as e:
            failed += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
        if idx < len(accounts) - 1:
            await jitter_delay(3, 5)
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}
