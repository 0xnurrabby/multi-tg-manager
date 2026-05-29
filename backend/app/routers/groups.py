import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.types import Channel, Chat, ChatForbidden, ChannelForbidden
from telethon.tl.functions.channels import JoinChannelRequest, LeaveChannelRequest, GetParticipantRequest
from telethon.tl.functions.messages import ImportChatInviteRequest, CheckChatInviteRequest
from telethon.errors import (
    FloodWaitError, UserAlreadyParticipantError, InviteHashExpiredError, UserNotParticipantError,
)
from time import time

from ..db import get_db
from ..models import Account
from ..schemas import (
    JoinIn, BulkJoinIn, GroupOut, LeaveIn, BulkLeaveIn,
    BulkLeaveTargetIn, BulkLeaveAllIn, BulkDeleteMyMessagesIn,
)
from ..tg_manager import manager
from ..utils import friendly_error, bulk_stream

# Optional import — older Telethon builds may not expose this name.
try:
    from telethon.errors import InviteRequestSentError
except ImportError:  # pragma: no cover
    InviteRequestSentError = None

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


# Hard cap on how many chats we'll auto-leave to make room for one join, so a
# misconfigured target can never strip an account bare.
_MAX_AUTO_LEAVES = 60


def _is_too_many(e: Exception) -> bool:
    """Telegram's ~500 channels+supergroups cap was hit."""
    return type(e).__name__ in ("ChannelsTooMuchError", "UserChannelsTooMuchError")


async def _target_chat_type(cli, target: str) -> str | None:
    """Best-effort: is the join target a 'channel' (broadcast) or 'group'
    (supergroup)? Returns None when it can't be told (private invite links)."""
    kind, payload = _parse_invite(target)
    if kind == "invite":
        return None  # can't resolve a private invite without joining
    try:
        ent = await cli.get_entity(payload)
    except Exception:
        return None
    if isinstance(ent, (Channel, ChannelForbidden)):
        return "group" if getattr(ent, "megagroup", False) else "channel"
    return "group"  # basic legacy group


async def _leave_candidates(cli, target_type: str | None) -> list:
    """Channels/supergroups this account can leave to free a cap slot, ordered
    by what to sacrifice first:
      1. joined (not created by me), matching the target's type
      2. joined, other type
      3. created by me, matching type
      4. created by me, other type
    Only Channel-type entities count toward the cap, so basic groups are skipped.
    """
    items: list[tuple[object, int, int]] = []
    async for dialog in cli.iter_dialogs():
        e = dialog.entity
        if not isinstance(e, (Channel, ChannelForbidden)):
            continue
        etype = "group" if getattr(e, "megagroup", False) else "channel"
        mine = 1 if getattr(e, "creator", False) else 0           # leave my own LAST
        type_rank = 0 if (target_type is None or etype == target_type) else 1
        items.append((e, mine, type_rank))
    items.sort(key=lambda it: (it[1], it[2]))
    return [it[0] for it in items]


async def _join_make_room(cli, target: str):
    """On a 'too many channels' error, leave ONE chat at a time and retry the
    join after each, stopping the moment it succeeds. Joined-from-others chats
    go first; the account's own created chats are sacrificed only last. Returns
    an (status, detail) tuple on success, or None if room couldn't be made."""
    target_type = await _target_chat_type(cli, target)
    candidates = await _leave_candidates(cli, target_type)
    left = left_own = 0
    for ent in candidates:
        if left >= _MAX_AUTO_LEAVES:
            break
        try:
            await cli(LeaveChannelRequest(ent))
        except FloodWaitError as fw:
            if fw.seconds > 30:
                break  # rate-limited too hard to keep going right now
            await asyncio.sleep(fw.seconds + 1)
            try:
                await cli(LeaveChannelRequest(ent))
            except Exception:
                continue
        except Exception:
            continue  # can't leave this one (already gone, forbidden) — try next
        left += 1
        if getattr(ent, "creator", False):
            left_own += 1
        await asyncio.sleep(0.5)  # small pace before retrying the join
        # retry the join now that a slot is free
        try:
            await _join_with_client(cli, target)
        except UserAlreadyParticipantError:
            pass
        except FloodWaitError as fw:
            if fw.seconds > 30:
                break
            await asyncio.sleep(fw.seconds + 1)
            try:
                await _join_with_client(cli, target)
            except UserAlreadyParticipantError:
                pass
            except Exception as e2:
                if _is_too_many(e2):
                    continue
                if InviteRequestSentError is not None and isinstance(e2, InviteRequestSentError):
                    return "pending", _room_detail("join request sent", left, left_own)
                raise
        except Exception as e2:
            if _is_too_many(e2):
                continue  # still full — leave another and retry
            if InviteRequestSentError is not None and isinstance(e2, InviteRequestSentError):
                return "pending", _room_detail("join request sent", left, left_own)
            raise
        return "ok", _room_detail("joined", left, left_own)
    return None


def _room_detail(prefix: str, left: int, left_own: int) -> str:
    detail = f"{prefix} after leaving {left} chat(s) to make room"
    if left_own:
        detail += f" ({left_own} you created)"
    return detail


async def _join_handle(cli, target: str) -> tuple[str, str]:
    """Join with safe auto-handling. Returns (status, detail).

    status is 'ok' or 'pending'. Recoverable cases are handled here:
      - already a member -> ok
      - join request sent (approval needed) -> pending
      - short FloodWait -> wait once, retry once
      - account at the channels cap -> leave one chat at a time (joined-from-
        others first, own-created last) and retry until it fits
    Anything else is raised so the caller can map it via friendly_error().
    """
    try:
        await _join_with_client(cli, target)
        return "ok", ""
    except UserAlreadyParticipantError:
        return "ok", "already a member"
    except FloodWaitError as e:
        if e.seconds <= 30:
            await asyncio.sleep(e.seconds + 1)
            try:
                await _join_with_client(cli, target)
                return "ok", "joined after a short wait"
            except UserAlreadyParticipantError:
                return "ok", "already a member"
        raise
    except Exception as e:
        if _is_too_many(e):
            res = await _join_make_room(cli, target)
            if res is not None:
                return res
            raise  # couldn't free a slot — re-raise so it soft-skips as before
        if InviteRequestSentError is not None and isinstance(e, InviteRequestSentError):
            return "pending", "join request sent (waiting for admin approval)"
        raise


@router.post("/{account_id}/join")
async def join_one(account_id: int, body: JoinIn):
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        status, detail = await _join_handle(cli, body.target)
        _cache.pop(account_id, None)
    except FloodWaitError as e:
        raise HTTPException(429, f"Rate limited — wait {e.seconds}s")
    except Exception as e:
        raise HTTPException(400, friendly_error(e))
    return {"ok": True, "status": status, "detail": detail}


@router.post("/bulk_join")
async def bulk_join(body: BulkJoinIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    target = body.target

    return StreamingResponse(
        bulk_stream(accounts, lambda cli, aid: _join_handle(cli, target),
                    on_success=lambda aid: _cache.pop(aid, None)),
        media_type="application/x-ndjson",
    )


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
        raise HTTPException(400, friendly_error(e))
    return {"ok": True}


async def _leave_with_client(cli, chat_id: int) -> tuple[str, str]:
    entity = await cli.get_entity(chat_id)
    if isinstance(entity, (Channel, ChannelForbidden)):
        await cli(LeaveChannelRequest(entity))
    else:
        await cli.delete_dialog(entity)
    return "ok", ""


@router.post("/bulk_leave")
async def bulk_leave(body: BulkLeaveIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    chat_id = body.chat_id

    return StreamingResponse(
        bulk_stream(accounts, lambda cli, aid: _leave_with_client(cli, chat_id),
                    on_success=lambda aid: _cache.pop(aid, None)),
        media_type="application/x-ndjson",
    )


async def _leave_by_target_with_client(cli, target: str) -> tuple[str, str]:
    """Leave a group/channel given by @username or invite link — but only if this
    account is actually a member. Non-members are reported as a soft 'skipped'."""
    kind, payload = _parse_invite(target)
    if kind == "invite":
        # Private link: CheckChatInvite tells us if we're already in (has .chat).
        try:
            inv = await cli(CheckChatInviteRequest(payload))
        except Exception:
            return "skipped", "invalid/expired invite link"
        entity = getattr(inv, "chat", None)
        if entity is None:
            return "skipped", "not a member"
    else:
        try:
            entity = await cli.get_entity(payload)
        except Exception:
            return "skipped", "can't resolve target"

    if isinstance(entity, (Channel, ChannelForbidden)):
        # Confirm membership so we don't report a no-op leave as success.
        try:
            await cli(GetParticipantRequest(entity, "me"))
        except UserNotParticipantError:
            return "skipped", "not a member"
        except Exception:
            pass  # check unavailable — fall through and attempt the leave
        await cli(LeaveChannelRequest(entity))
    else:
        try:
            await cli.delete_dialog(entity)
        except Exception:
            return "skipped", "not a member"
    return "ok", ""


@router.post("/bulk_leave_target")
async def bulk_leave_target(body: BulkLeaveTargetIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    target = body.target

    return StreamingResponse(
        bulk_stream(accounts, lambda cli, aid: _leave_by_target_with_client(cli, target),
                    on_success=lambda aid: _cache.pop(aid, None)),
        media_type="application/x-ndjson",
    )


# Short pause between per-group operations WITHIN one account, to stay under
# Telegram's per-account rate limits when an account is in many groups.
_INTRA_DELAY = 0.4


async def _collect_chats(cli) -> list:
    """All group/supergroup/channel entities this account is in (skips DMs/bots)."""
    entities = []
    async for dialog in cli.iter_dialogs():
        e = dialog.entity
        if isinstance(e, (Chat, ChatForbidden, Channel, ChannelForbidden)):
            entities.append(e)
    return entities


async def _leave_entity(cli, entity):
    if isinstance(entity, (Channel, ChannelForbidden)):
        await cli(LeaveChannelRequest(entity))
    else:
        await cli.delete_dialog(entity)


async def _leave_all_for_client(cli, aid: int) -> tuple[str, str]:
    """Leave every group/channel this account is in. Never raises FloodWait —
    a long wait stops this account early and reports partial progress."""
    entities = await _collect_chats(cli)
    left = errors = 0
    for entity in entities:
        try:
            await _leave_entity(cli, entity)
            left += 1
        except FloodWaitError as fw:
            if fw.seconds <= 30:
                await asyncio.sleep(fw.seconds + 1)
                try:
                    await _leave_entity(cli, entity); left += 1
                except Exception:
                    errors += 1
            else:
                detail = f"left {left}/{len(entities)}, stopped (rate limit {fw.seconds}s)"
                return "ok", detail
        except Exception:
            errors += 1
        await asyncio.sleep(_INTRA_DELAY)
    detail = f"left {left} of {len(entities)}" + (f", {errors} error(s)" if errors else "")
    return "ok", detail


async def _delete_all_my_messages_for_client(cli, aid: int, max_scan: int) -> tuple[str, str]:
    """Delete (revoke) every message this account sent across all its groups/channels."""
    me = await cli.get_me()
    entities = await _collect_chats(cli)
    scan = min(max(max_scan, 1), 10000)
    total_deleted = groups_touched = 0
    for entity in entities:
        ids: list[int] = []
        try:
            async for msg in cli.iter_messages(entity, from_user=me, limit=scan):
                ids.append(msg.id)
        except Exception:
            continue  # can't read this chat (banned/forbidden) — skip it
        if not ids:
            continue
        deleted_here = 0
        for i in range(0, len(ids), 100):
            batch = ids[i:i + 100]
            try:
                await cli.delete_messages(entity, batch, revoke=True)
                deleted_here += len(batch)
            except FloodWaitError as fw:
                if fw.seconds <= 30:
                    await asyncio.sleep(fw.seconds + 1)
                    try:
                        await cli.delete_messages(entity, batch, revoke=True)
                        deleted_here += len(batch)
                    except Exception:
                        pass
                else:
                    total_deleted += deleted_here
                    return "ok", (f"deleted {total_deleted} in {groups_touched} group(s), "
                                  f"stopped (rate limit {fw.seconds}s)")
            except Exception:
                pass
        if deleted_here:
            total_deleted += deleted_here
            groups_touched += 1
        await asyncio.sleep(_INTRA_DELAY)
    return "ok", f"deleted {total_deleted} msg(s) in {groups_touched} group(s)"


@router.post("/bulk_leave_all")
async def bulk_leave_all(body: BulkLeaveAllIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    return StreamingResponse(
        bulk_stream(accounts, _leave_all_for_client,
                    on_success=lambda aid: _cache.pop(aid, None)),
        media_type="application/x-ndjson",
    )


@router.post("/bulk_delete_my_messages")
async def bulk_delete_my_messages(body: BulkDeleteMyMessagesIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in res.scalars().all()
    ]
    max_scan = body.max_scan

    return StreamingResponse(
        bulk_stream(accounts, lambda cli, aid: _delete_all_my_messages_for_client(cli, aid, max_scan)),
        media_type="application/x-ndjson",
    )


@router.get("/{account_id}/my_messages_count")
async def count_my_messages(account_id: int, chat_id: int, max_scan: int = 1000):
    """Count how many messages the logged-in user has in the given chat
    (scans up to max_scan recent messages)."""
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        entity = await cli.get_entity(chat_id)
        me = await cli.get_me()
        count = 0
        async for msg in cli.iter_messages(entity, from_user=me, limit=min(max(max_scan, 1), 5000)):
            count += 1
        return {"count": count, "scanned_limit": max_scan}
    except Exception as e:
        raise HTTPException(400, friendly_error(e))


@router.post("/{account_id}/delete_my_messages")
async def delete_my_messages(account_id: int, chat_id: int, max_scan: int = 2000):
    """Delete every message the logged-in user sent in the given chat
    (for everyone, revoke=True). Scans up to max_scan recent messages."""
    cli = manager.get(account_id)
    if not cli:
        raise HTTPException(409, "Account not connected")
    try:
        entity = await cli.get_entity(chat_id)
        me = await cli.get_me()
        ids: list[int] = []
        async for msg in cli.iter_messages(entity, from_user=me, limit=min(max(max_scan, 1), 10000)):
            ids.append(msg.id)
        if not ids:
            return {"deleted": 0, "scanned_limit": max_scan}
        # Telegram limits delete batches to 100
        deleted = 0
        for i in range(0, len(ids), 100):
            batch = ids[i:i+100]
            try:
                res = await cli.delete_messages(entity, batch, revoke=True)
                # res can be list or PtsCountInt; treat success per id
                deleted += len(batch)
            except FloodWaitError as e:
                raise HTTPException(429, f"FloodWait: wait {e.seconds}s after {deleted} deleted")
        _cache.pop(account_id, None)
        return {"deleted": deleted, "scanned_limit": max_scan}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, friendly_error(e))
