from __future__ import annotations
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Account, AiChatMessage, AiChatProfile
from ..schemas import AiSettingsIn, AiStartIn, AiStopIn
from ..tg_manager import manager
from .. import ai_store
from ..ai_chat import ai_manager, validate_gateway, GatewayError

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
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


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
async def chat_status(limit: int = 30, db: AsyncSession = Depends(get_db)):
    limit = max(5, min(int(limit or 30), 100))
    state = ai_manager.snapshot()

    res = await db.execute(select(Account))
    accounts = {a.id: a for a in res.scalars().all()}

    res = await db.execute(select(AiChatProfile))
    profiles = {p.account_id: p for p in res.scalars().all()}
    ids = set(state.keys()) | set(profiles.keys())
    ids &= set(accounts.keys())

    out = []
    for aid in ids:
        acc = accounts.get(aid)
        if not acc:
            continue
        prof = profiles.get(aid)
        reset_at = prof.reset_at if prof and prof.reset_at else None
        q = select(AiChatMessage).where(AiChatMessage.account_id == aid)
        if reset_at is not None:
            q = q.where(AiChatMessage.created_at >= reset_at)
        q = q.order_by(desc(AiChatMessage.id)).limit(limit)
        res = await db.execute(q)
        rows = list(res.scalars().all())
        rows.reverse()
        msgs = [_msg_dict(m) for m in rows]
        st = state.get(aid) or {}
        if not msgs and not st.get("running") and not st.get("last_error"):
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
            "last_error": st.get("last_error") or "",
            "started_at": st.get("started_at"),
            "last_activity": last_activity,
            "messages": msgs,
        })

    # Running first, then latest activity.
    out.sort(key=lambda x: (1 if x["running"] else 0, str(x.get("last_activity") or "")), reverse=True)

    cfg = await ai_store.get_settings()
    return {
        "settings": _public_settings(cfg),
        "running": len(ai_manager.running_ids()),
        "accounts": out,
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


@router.post("/chat/start")
async def start_chats(body: AiStartIn, db: AsyncSession = Depends(get_db)):
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
    errors: list[dict] = []
    seen = set()
    for acc in accounts:
        seen.add(acc.id)
        if not manager.get(acc.id):
            errors.append({"account_id": acc.id, "error": "Account is not connected"})
            continue
        try:
            ok = await ai_manager.start(
                acc, cfg["api_key"], model, target,
                cfg.get("min_turns") or 4, cfg.get("max_turns") or 10,
            )
            if ok:
                started.append(acc.id)
        except Exception as e:
            errors.append({"account_id": acc.id, "error": str(e)[:200]})
    for aid in body.account_ids:
        if aid not in seen:
            errors.append({"account_id": aid, "error": "Account not found"})
    return {"started": started, "errors": errors, "running": len(ai_manager.running_ids())}


@router.post("/chat/stop")
async def stop_chats(body: AiStopIn | None = None):
    ids = body.account_ids if body and body.account_ids else None
    stopped = await ai_manager.stop(ids)
    return {"stopped": stopped, "running": len(ai_manager.running_ids())}
