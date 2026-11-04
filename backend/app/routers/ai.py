from __future__ import annotations
import asyncio
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Account, AiChatMessage, AiChatProfile
from ..schemas import AiCustomIn, AiDailyCountsIn, AiSettingsIn, AiStartIn, AiStopIn
from ..tg_manager import manager
from ..utils import bulk_stream
from .. import ai_store
from ..ai_chat import (
    DAILY_LIMIT,
    GatewayError,
    ai_manager,
    bd_day_key,
    count_sent_today,
    daily_reset_utc,
    validate_gateway,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _public_settings(cfg: dict) -> dict:
    return {
        "has_key": bool(cfg.get("has_key")),
        "key_preview": cfg.get("key_preview") or "",
        "model": cfg.get("model"),
        "target": cfg.get("target"),
        "min_turns": cfg.get("min_turns"),
        "max_turns": cfg.get("max_turns"),
    }


def _normalize_target(raw: str | None) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    for pre in ("https://t.me/", "http://t.me/", "https://telegram.me/", "http://telegram.me/", "t.me/", "telegram.me/"):
        if s.lower().startswith(pre):
            s = s[len(pre):]
            break
    s = s.split("?", 1)[0].split("/", 1)[0].strip()
    if not s:
        return ""
    if not s.startswith("@") and not re.fullmatch(r"-?\d+", s):
        s = "@" + s
    return s


def _msg_dict(m: AiChatMessage) -> dict:
    return {
        "id": m.id,
        "direction": m.direction,
        "text": m.text,
        "tg_msg_id": m.tg_msg_id,
        "reply_to_text": m.reply_to_text,
        "reaction": m.reaction,
        "is_custom": bool(m.is_custom),
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


async def _daily_counts(accounts: list[Account], target: str) -> tuple[dict[int, int], list[dict]]:
    sem = asyncio.Semaphore(10)

    async def one(acc: Account):
        cli = manager.get(acc.id)
        if not cli or not cli.is_connected():
            raise RuntimeError("Account is not connected")
        async with sem:
            return await count_sent_today(cli, target)

    counts: dict[int, int] = {}
    errors: list[dict] = []
    results = await asyncio.gather(*(one(a) for a in accounts), return_exceptions=True)
    for acc, result in zip(accounts, results):
        if isinstance(result, Exception):
            errors.append({"account_id": acc.id, "error": str(result)[:200]})
        else:
            counts[acc.id] = int(result)
    return counts, errors


@router.get("/settings")
async def get_ai_settings():
    cfg = await ai_store.get_settings()
    return _public_settings(cfg)


@router.put("/settings")
async def save_ai_settings(body: AiSettingsIn):
    current = await ai_store.get_settings()
    model = (body.model or current.get("model") or "").strip()
    target = _normalize_target(body.target if body.target is not None else current.get("target"))
    if not model:
        raise HTTPException(400, "Model is required")
    if not target:
        raise HTTPException(400, "Target bot is required")

    new_key = (body.api_key or "").strip()
    key_for_check = new_key or current.get("api_key") or ""
    if key_for_check and (new_key or model != current.get("model")):
        try:
            await validate_gateway(key_for_check, model)
        except GatewayError as e:
            code = e.status if 400 <= (e.status or 0) < 500 else 502
            if e.status in (401, 403):
                msg = "The AI Gateway API key was rejected. Check the key and try again."
            elif e.status == 404:
                msg = f"Model '{model}' was not found on Vercel AI Gateway."
            else:
                msg = str(e)
            raise HTTPException(code, msg)

    cfg = await ai_store.save_settings(
        api_key=new_key or None,
        model=model,
        target=target,
        min_turns=body.min_turns,
        max_turns=body.max_turns,
    )
    return _public_settings(cfg)


@router.delete("/settings")
async def clear_ai_key():
    cfg = await ai_store.clear_key()
    return _public_settings(cfg)


@router.get("/chat/status")
async def chat_status(limit: int = 30, include_messages: bool = True,
                      db: AsyncSession = Depends(get_db)):
    limit = max(2, min(int(limit or 30), 100))
    state = ai_manager.snapshot()

    res = await db.execute(select(Account))
    accounts = {a.id: a for a in res.scalars().all()}

    res = await db.execute(select(AiChatProfile))
    profiles = {p.account_id: p for p in res.scalars().all()}
    ids = set(state.keys()) | set(profiles.keys())
    ids &= set(accounts.keys())
    today = bd_day_key()
    recent_cutoff = datetime.utcnow() - timedelta(minutes=10)
    res = await db.execute(
        select(AiChatMessage.account_id, func.count(AiChatMessage.id))
        .where(
            AiChatMessage.direction == "me",
            AiChatMessage.created_at >= recent_cutoff,
        )
        .group_by(AiChatMessage.account_id)
    )
    recent_counts = {aid: count for aid, count in res.all()}

    out = []
    for aid in ids:
        acc = accounts.get(aid)
        if not acc:
            continue
        prof = profiles.get(aid)
        msgs = []
        st = state.get(aid) or {}
        limit_today = bool(prof and prof.limit_day == today)
        if limit_today and not st:
            st = {
                "status": "limit",
                "running": False,
                "daily_limit": int(prof.daily_limit or DAILY_LIMIT) if prof else DAILY_LIMIT,
                "last_error": "Daily limit reached. Skipping this account until the next reset.",
            }
        if not msgs and not st.get("running") and not st.get("last_error") and not st.get("daily_limit") and not limit_today:
            continue
        fallback = ai_manager.persona_for(acc)
        last_activity = st.get("last_activity") or (msgs[-1]["created_at"] if msgs else None)
        out.append({
            "account_id": aid,
            "phone": acc.phone,
            "name": (f"{acc.first_name or ''} {acc.last_name or ''}".strip() or acc.phone),
            "username": acc.username or "",
            "running": bool(st.get("running")),
            "status": st.get("status") or "stopped",
            "persona": st.get("persona") or (prof.persona if prof else fallback.get("label")),
            "language": st.get("language") or (prof.language if prof else fallback.get("language")),
            "topic": st.get("topic") or (prof.topic if prof else fallback.get("topic")),
            "turns_done": int(st.get("turns_done") or 0),
            "turn_target": int(st.get("turn_target") or 0),
            "daily_sent": int(st.get("daily_sent") or 0),
            "daily_limit": int(
                st.get("daily_limit")
                or (prof.daily_limit if prof else 0)
                or DAILY_LIMIT
            ),
            "fill_daily": bool(st.get("fill_daily")),
            "last_error": st.get("last_error") or "",
            "started_at": st.get("started_at"),
            "last_activity": last_activity,
            "messages": msgs,
        })

    for chat in out:
        remaining = max(0, int(chat["daily_limit"]) - int(chat["daily_sent"]))
        rate = recent_counts.get(chat["account_id"], 0) / 10.0
        chat["remaining_messages"] = remaining
        chat["rate_per_min"] = round(rate, 2)
        if chat["status"] == "limit" or remaining <= 0:
            chat["eta_seconds"] = 0
        elif not chat["running"]:
            chat["eta_seconds"] = None
        elif rate > 0:
            chat["eta_seconds"] = int(remaining / rate * 60)
        else:
            chat["eta_seconds"] = None

    active_chats = [c for c in out if c["running"]]
    now = datetime.now(timezone.utc)
    reset = daily_reset_utc()
    if reset <= now:
        reset = reset + timedelta(days=1)
    remaining_total = sum(c["remaining_messages"] for c in active_chats)
    rate_total = round(sum(c["rate_per_min"] for c in active_chats), 2)
    known_etas = [c["eta_seconds"] for c in active_chats if c["eta_seconds"] is not None]
    finish_at = None
    finish_in = 0
    finish_reason = "idle"
    if active_chats:
        if all(c["remaining_messages"] <= 0 for c in active_chats):
            finish_reason = "done"
            finish_at = now
        elif known_etas:
            max_eta = max(known_etas)
            estimated = now + timedelta(seconds=max_eta)
            if estimated > reset:
                estimated = reset
                finish_reason = "reset"
            else:
                finish_reason = "limit"
            finish_at = estimated
            finish_in = max(0, int((estimated - now).total_seconds()))
        else:
            finish_reason = "calculating"

    # Running first, then latest activity.
    out.sort(key=lambda x: (1 if x["running"] else 0, str(x.get("last_activity") or "")), reverse=True)

    # Message bodies are only needed for the cards visible on screen. Querying
    # 400+ accounts x N messages on every status poll made the local UI lag.
    if include_messages:
        for chat in out[:20]:
            aid = chat["account_id"]
            prof = profiles.get(aid)
            reset_at = prof.reset_at if prof and prof.reset_at else None
            q = select(AiChatMessage).where(AiChatMessage.account_id == aid)
            if reset_at is not None:
                q = q.where(AiChatMessage.created_at >= reset_at)
            q = q.order_by(desc(AiChatMessage.id)).limit(limit)
            res = await db.execute(q)
            rows = list(res.scalars().all())
            rows.reverse()
            chat["messages"] = [_msg_dict(m) for m in rows]

    cfg = await ai_store.get_settings()
    snapshot = ai_manager.snapshot()
    queued = sum(
        1 for st in snapshot.values()
        if st.get("running") and st.get("status") == "queued"
    )
    return {
        "settings": _public_settings(cfg),
        "running": len(ai_manager.running_ids()),
        "active": len(ai_manager.active_ids()),
        "queued": queued,
        "accounts": out,
        "finish_at": finish_at.isoformat() if finish_at else None,
        "finish_in_seconds": finish_in,
        "finish_reason": finish_reason,
        "remaining_messages": remaining_total,
        "rate_per_min": rate_total,
        "accounts_at_limit": sum(1 for c in out if c["status"] == "limit"),
        "reset_at": reset.isoformat(),
    }


@router.get("/chat/messages")
async def chat_messages(account_id: int, after_id: int = 0, limit: int = 100,
                        db: AsyncSession = Depends(get_db)):
    q = select(AiChatMessage).where(AiChatMessage.account_id == account_id)
    if after_id:
        q = q.where(AiChatMessage.id > after_id)
    q = q.order_by(AiChatMessage.id.asc()).limit(max(1, min(int(limit or 100), 300)))
    res = await db.execute(q)
    return {"messages": [_msg_dict(m) for m in res.scalars().all()]}


@router.get("/chat/daily")
async def daily_counts_info():
    return {"daily_limit": DAILY_LIMIT, "reset_at": daily_reset_utc().isoformat()}


@router.post("/chat/daily_counts")
async def daily_counts(body: AiDailyCountsIn, db: AsyncSession = Depends(get_db)):
    cfg = await ai_store.get_settings()
    target = _normalize_target(cfg.get("target")) or ai_store.DEFAULT_TARGET

    q = select(Account)
    if body.account_ids:
        q = q.where(Account.id.in_(body.account_ids), Account.status != "banned")
    else:
        q = q.where(Account.status == "connected")
    res = await db.execute(q)
    accounts = list(res.scalars().all())
    counts, errors = await _daily_counts(accounts, target)

    seen = {a.id for a in accounts}
    for aid in body.account_ids:
        if aid not in seen:
            errors.append({"account_id": aid, "error": "Account not found"})

    return {
        "daily_limit": DAILY_LIMIT,
        "reset_at": daily_reset_utc().isoformat(),
        "counts": counts,
        "errors": errors,
    }


@router.post("/chat/custom")
async def send_custom_message(body: AiCustomIn, db: AsyncSession = Depends(get_db)):
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(400, "Write a custom message first")
    if len(text) > 4096:
        raise HTTPException(400, "Custom message is too long")
    cfg = await ai_store.get_settings()
    target = _normalize_target(cfg.get("target")) or ai_store.DEFAULT_TARGET

    q = select(Account).where(Account.status != "banned")
    if body.account_ids:
        q = q.where(Account.id.in_(body.account_ids))
    res = await db.execute(q)
    accounts = list(res.scalars().all())
    if not accounts:
        raise HTTPException(400, "No connected accounts selected")
    by_id = {a.id: a for a in accounts}
    ordered = [by_id[i] for i in body.account_ids if i in by_id] if body.account_ids else accounts
    rows = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in ordered
    ]

    async def _do(cli, aid):
        if ai_manager.is_running(aid):
            return "skipped", "AI chat is running"
        acc = by_id.get(aid)
        if not acc:
            return "skipped", "account not found"
        result = await ai_manager.send_custom([acc], target, text)
        if result["sent"]:
            return "ok", f"sent to {target}"
        if result["errors"]:
            raise RuntimeError(result["errors"][0]["error"])
        return "skipped", "not connected"

    return StreamingResponse(
        bulk_stream(rows, _do, concurrency=10),
        media_type="application/x-ndjson",
    )


@router.post("/chat/start")
async def start_chats(body: AiStartIn, request: Request, db: AsyncSession = Depends(get_db)):
    if request.headers.get("x-ai-manual") != "1":
        raise HTTPException(403, "AI chat can only be started from the AI Chat screen button.")
    if not body.account_ids:
        raise HTTPException(400, "Pick at least one account")
    cfg = await ai_store.get_settings()
    if not cfg.get("has_key"):
        raise HTTPException(400, "Add your Vercel AI Gateway API key first")
    model = cfg.get("model") or ai_store.DEFAULT_MODEL
    target = _normalize_target(cfg.get("target")) or ai_store.DEFAULT_TARGET

    res = await db.execute(
        select(Account).where(Account.id.in_(body.account_ids), Account.status != "banned")
    )
    accounts = list(res.scalars().all())
    started: list[int] = []
    skipped: list[int] = []
    errors: list[dict] = []
    counts: dict[int, int] = {}
    limits: dict[int, int] = {}
    res = await db.execute(
        select(AiChatProfile).where(
            AiChatProfile.account_id.in_([a.id for a in accounts])
        )
    )
    profiles_by_id = {p.account_id: p for p in res.scalars().all()}

    # The DB can still say "connected" after a session failed to load at boot.
    # Reconnect those missing clients before counting or starting.
    missing = [a for a in accounts if not manager.get(a.id)]
    if missing:
        reconnect_sem = asyncio.Semaphore(6)

        async def reconnect(acc):
            async with reconnect_sem:
                try:
                    await manager.start_client(acc)
                except Exception:
                    pass

        await asyncio.gather(*(reconnect(a) for a in missing), return_exceptions=True)
    blocked: set[int] = set()
    if body.fill_daily:
        counts, count_errors = await _daily_counts(accounts, target)
        errors.extend(count_errors)
        today = bd_day_key()
        blocked = {
            p.account_id for p in profiles_by_id.values()
            if p.limit_day == today
        }

    custom_reset = set(
        await ai_manager.reset_context_after_custom([a.id for a in accounts])
    )
    stagger_max = 0.0

    seen = set()
    for acc in accounts:
        seen.add(acc.id)
        if not manager.get(acc.id):
            if not any(e["account_id"] == acc.id for e in errors):
                errors.append({"account_id": acc.id, "error": "Account is not connected"})
            continue
        remaining = None
        target_limit = DAILY_LIMIT
        if body.fill_daily:
            prof = profiles_by_id.get(acc.id)
            target_limit = min(
                DAILY_LIMIT,
                max(1, int(getattr(prof, "daily_limit", 0) or DAILY_LIMIT)),
            )
            limits[acc.id] = target_limit
            if ai_manager.is_running(acc.id):
                skipped.append(acc.id)
                continue
            if acc.id not in counts:
                continue
            remaining = target_limit - counts[acc.id]
            if remaining <= 0:
                ai_manager.mark_daily(acc.id, counts[acc.id], target_limit)
                skipped.append(acc.id)
                continue
            if acc.id in blocked:
                ai_manager.mark_daily(
                    acc.id, counts[acc.id], target_limit,
                    status="limit",
                    last_error="Daily limit reached. Skipping this account until the next reset.",
                )
                skipped.append(acc.id)
                continue
        try:
            ok = await ai_manager.start(
                acc, cfg["api_key"], model, target,
                cfg.get("min_turns") or 4, cfg.get("max_turns") or 10,
                fixed_target=remaining,
                skip_start=body.fill_daily or acc.id in custom_reset,
                daily_sent=counts.get(acc.id, 0) if body.fill_daily else 0,
                daily_limit=target_limit if body.fill_daily else 0,
                fill_daily=body.fill_daily,
                stagger_max=stagger_max,
            )
            if ok:
                started.append(acc.id)
            elif body.fill_daily:
                skipped.append(acc.id)
        except Exception as e:
            errors.append({"account_id": acc.id, "error": str(e)[:200]})
    for aid in body.account_ids:
        if aid not in seen:
            errors.append({"account_id": aid, "error": "Account not found"})
    return {
        "started": started,
        "skipped": skipped,
        "counts": counts,
        "limits": limits,
        "daily_limit": DAILY_LIMIT,
        "errors": errors,
        "running": len(ai_manager.running_ids()),
    }


@router.post("/chat/stop")
async def stop_chats(body: AiStopIn | None = None):
    ids = body.account_ids if body and body.account_ids else None
    stopped = await ai_manager.stop(ids)
    return {"stopped": stopped, "running": len(ai_manager.running_ids())}
