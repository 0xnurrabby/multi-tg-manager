from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.functions.account import (
    CheckUsernameRequest,
    UpdateProfileRequest,
    UpdateUsernameRequest,
)
from telethon.tl.functions.photos import UploadProfilePhotoRequest
from telethon.errors import (
    FloodWaitError,
    UsernameInvalidError,
    UsernameNotModifiedError,
    UsernameOccupiedError,
)
import asyncio
import json
import logging
import random
import re
import tempfile
import os

from ..db import get_db, AsyncSessionLocal
from ..models import Account
from ..schemas import BulkAiProfileIn, BulkProfileIn
from ..tg_manager import manager
from ..utils import bulk_stream
from .. import ai_store
from ..ai_chat import _gateway_request

router = APIRouter(prefix="/api/bulk", tags=["bulk"])
log = logging.getLogger("bulk")

AI_COUNTRIES = [
    "Bangladesh", "India", "Pakistan", "Turkey", "Egypt", "Nigeria", "Kenya",
    "Morocco", "Brazil", "Mexico", "Argentina", "Colombia", "Chile", "Peru",
    "Russia", "Ukraine", "Poland", "Germany", "France", "Italy", "Spain",
    "Portugal", "Netherlands", "Sweden", "Norway", "Japan", "South Korea",
    "China", "Thailand", "Vietnam", "Indonesia", "Malaysia", "Philippines",
    "Saudi Arabia", "United Arab Emirates", "Iran", "Iraq", "Kazakhstan",
    "United States", "Canada", "Australia", "South Africa", "Ghana", "Nepal",
    "Sri Lanka", "Myanmar",
]

AI_USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]{7,23}$")


def _ai_profile_cost(model: str | None) -> float:
    m = (model or "").lower()
    if "deepseek" in m:
        return 0.00005
    if "haiku" in m:
        return 0.00012
    return 0.00015


def _clean_profile_name(value) -> str:
    return " ".join(str(value or "").split()).strip()[:32]


def _clean_username(value) -> str:
    value = re.sub(r"[^a-z0-9_]", "", str(value or "").lower().lstrip("@"))
    return value.strip("_")


def _extract_profile_json(content: str) -> dict:
    text = (content or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I | re.M)
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("AI did not return JSON")
    return json.loads(match.group(0))


async def _generate_ai_profile(api_key: str, model: str, account: Account,
                               country: str, avoid_names: list[str]):
    current = f"{account.first_name or ''} {account.last_name or ''}".strip() or "none"
    avoid = ", ".join(avoid_names[-20:]) or "none"
    system = (
        "You invent believable Telegram profile identities. Return only valid JSON, "
        "with no markdown and no explanation. Use a natural human name that fits the "
        "given country. The username must feel premium and slightly stylized, based on "
        "the name, lowercase ASCII, 10-24 characters, one optional underscore, and may "
        "use 1, 3, 4 or 7 as letter substitutes or 1-3 digits. Never return the exact "
        "plain name as the username. Give six different high-availability candidates. "
        "Do not use @, spaces, dots, hyphens, generic words, or famous people."
    )
    user = (
        f"Country: {country}\n"
        f"Current name: {current}\n"
        f"Avoid these names: {avoid}\n"
        f"Return JSON exactly like: "
        f'{{"first_name":"Abrar","last_name":"Fahad","usernames":["abrarfahad30","afr1d1khan48","ajay_k4ja"]}}'
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.95,
        "max_tokens": 300,
        "reasoning": {"enabled": False},
    }
    data = await asyncio.to_thread(
        _gateway_request, "POST", "/chat/completions", api_key, payload, 45.0,
    )
    choice = (data.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content") or ""
    if isinstance(content, list):
        content = " ".join(
            block.get("text", "") for block in content if isinstance(block, dict)
        )
    obj = _extract_profile_json(content)
    first = _clean_profile_name(obj.get("first_name"))
    last = _clean_profile_name(obj.get("last_name"))
    raw_usernames = obj.get("usernames") or []
    if isinstance(raw_usernames, str):
        raw_usernames = [raw_usernames]
    usernames = []
    for raw in raw_usernames:
        candidate = _clean_username(raw)
        if AI_USERNAME_RE.match(candidate) and candidate not in usernames:
            usernames.append(candidate)
    if not first or not usernames:
        raise ValueError("AI returned an incomplete profile")
    return first, last, usernames[:6]


async def _apply_ai_profile(cli, account: Account, api_key: str, model: str,
                            avoid_names: list[str]):
    first = last = ""
    usernames: list[str] = []
    last_error = None
    for _ in range(2):
        country = random.choice(AI_COUNTRIES)
        try:
            first, last, usernames = await _generate_ai_profile(
                api_key, model, account, country, avoid_names,
            )
            break
        except Exception as e:
            last_error = e
            await asyncio.sleep(1)
    if not first or not usernames:
        raise RuntimeError(f"AI profile generation failed: {last_error}")

    chosen = None
    for candidate in usernames[:5]:
        if candidate == (account.username or "").lower():
            continue
        try:
            available = await cli(CheckUsernameRequest(username=candidate))
        except FloodWaitError as e:
            raise RuntimeError(f"Telegram FloodWait {e.seconds}s")
        except (UsernameInvalidError, UsernameOccupiedError):
            continue
        except Exception:
            continue
        if not available:
            continue
        try:
            await cli(UpdateUsernameRequest(username=candidate))
            chosen = candidate
            break
        except UsernameNotModifiedError:
            chosen = candidate
            break
        except (UsernameInvalidError, UsernameOccupiedError):
            continue
        except FloodWaitError as e:
            raise RuntimeError(f"Telegram FloodWait {e.seconds}s")
    if not chosen:
        raise RuntimeError("No available username after 5 tries")

    await cli(UpdateProfileRequest(first_name=first, last_name=last))
    async with AsyncSessionLocal() as db:
        row = await db.get(Account, account.id)
        if row:
            row.first_name = first
            row.last_name = last
            row.username = chosen
            await db.commit()
    avoid_names.append(f"{first} {last}".strip())
    return f"{first} {last} @{chosen}"


@router.post("/ai_profiles/estimate")
async def ai_profile_estimate(body: BulkAiProfileIn):
    cfg = await ai_store.get_settings()
    count = len(set(body.account_ids or []))
    per = _ai_profile_cost(cfg.get("model"))
    return {
        "has_key": bool(cfg.get("has_key")),
        "model": cfg.get("model") or "",
        "account_count": count,
        "per_account_usd": per,
        "estimated_cost_usd": round(count * per, 6),
        "note": "One AI generation per account; username checks are free. Actual cost can vary.",
    }


@router.post("/ai_profiles")
async def bulk_ai_profiles(body: BulkAiProfileIn, db: AsyncSession = Depends(get_db)):
    ids = list(dict.fromkeys(body.account_ids or []))
    if not ids:
        raise HTTPException(400, "Pick at least one account")
    cfg = await ai_store.get_settings()
    if not cfg.get("has_key"):
        raise HTTPException(400, "Add your AI Gateway key in AI Chat first")
    api_key = cfg["api_key"]
    model = cfg.get("model") or ai_store.DEFAULT_MODEL

    res = await db.execute(select(Account).where(Account.id.in_(ids)))
    by_id = {a.id: a for a in res.scalars().all()}
    ordered = [by_id[i] for i in ids if i in by_id]
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in ordered
    ]
    avoid_names: list[str] = []

    async def _do(cli, aid):
        account = by_id.get(aid)
        if not account:
            return "skipped", "account not found"
        detail = await _apply_ai_profile(cli, account, api_key, model, avoid_names)
        return "ok", detail

    return StreamingResponse(
        bulk_stream(accounts, _do, concurrency=4),
        media_type="application/x-ndjson",
    )


@router.post("/profile")
async def bulk_profile(body: BulkProfileIn, db: AsyncSession = Depends(get_db)):
    """Streaming bulk profile edit (live progress).
       - same first_name/last_name/bio for everyone (with optional number suffix), OR
       - per_account: { account_id: {first_name, last_name, bio} } (from CSV import)
    """
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    by_id = {a.id: a for a in res.scalars().all()}

    # Pre-compute the field changes per account in selection order so the parallel
    # workers stay deterministic (e.g. "Family 1", "Family 2" numbering).
    plan: dict[int, dict] = {}
    uname_plan: dict[int, str] = {}   # account_id -> desired @username
    n = body.start_number
    for aid in body.account_ids:
        acc = by_id.get(aid)
        if not acc:
            continue
        per = body.per_account.get(str(aid)) if body.per_account else None
        fn = (per or {}).get("first_name") if per else body.first_name
        ln = (per or {}).get("last_name") if per else body.last_name
        bio = (per or {}).get("bio") if per else body.bio
        # Username: can come from CSV (per-account) OR simple mode with append_number.
        # Telegram usernames are globally unique, so simple mode only works with
        # append_number to generate unique usernames (e.g. "myuser1", "myuser2").
        uname = (per or {}).get("username") if per else body.username
        kw: dict = {}
        used_number = False
        if fn is not None:
            if body.append_number and not per:
                fn = f"{fn} {n}"; used_number = True
            kw["first_name"] = fn
        if ln is not None:
            if body.append_number and not per:
                ln = f"{ln} {n}"; used_number = True
            kw["last_name"] = ln
        if bio is not None:
            kw["about"] = bio
        plan[aid] = kw
        if uname:
            cleaned = uname.strip().lstrip("@")
            if cleaned:
                # In simple mode with append_number, append the number to username
                if body.append_number and not per:
                    cleaned = f"{cleaned}{n}"
                    used_number = True
                uname_plan[aid] = cleaned
        if used_number:
            n += 1

    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in (by_id[i] for i in body.account_ids if i in by_id)
    ]

    async def _do(cli, aid):
        kw = plan.get(aid) or {}
        uname = uname_plan.get(aid)
        if not kw and not uname:
            return "ok", "nothing to change"
        detail: list[str] = []

        # 1) name / bio (single UpdateProfile call)
        if kw:
            if kw.get("about") is not None and len(kw["about"]) > 70:
                raise ValueError("Bio max 70 chars")
            await cli(UpdateProfileRequest(**kw))

        # 2) username (separate call; may fail per-account — taken/invalid surface
        #    as a failed row via friendly_error, "unchanged" counts as success).
        username_set = None
        if uname:
            try:
                await cli(UpdateUsernameRequest(username=uname))
                username_set = uname
                detail.append(f"@{uname}")
            except UsernameNotModifiedError:
                username_set = uname
                detail.append(f"@{uname} (unchanged)")

        # persist whatever actually changed
        if kw or username_set:
            async with AsyncSessionLocal() as s:
                acc = await s.get(Account, aid)
                if acc:
                    if "first_name" in kw: acc.first_name = kw["first_name"]
                    if "last_name" in kw: acc.last_name = kw["last_name"]
                    if "about" in kw: acc.bio = kw["about"]
                    if username_set is not None: acc.username = username_set
                    await s.commit()
        return "ok", ", ".join(detail)

    return StreamingResponse(bulk_stream(accounts, _do), media_type="application/x-ndjson")


@router.post("/photo")
async def bulk_photo(
    account_ids: str = Form(...),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Streaming bulk profile photo (live progress). One photo per account in order.
    - If len(files) >= len(accounts): first N files used, rest ignored.
    - If len(files) <  len(accounts): only first len(files) accounts updated, others skipped.
    """
    ids = [int(x) for x in account_ids.split(",") if x.strip()]
    res = await db.execute(select(Account).where(Account.id.in_(ids)))
    by_id = {a.id: a for a in res.scalars().all()}
    ordered = [by_id[i] for i in ids if i in by_id]

    # write all uploads to disk first; map account-index -> temp path
    tmp_paths: list[str] = []
    for f in files:
        data = await f.read()
        suffix = os.path.splitext(f.filename or "photo.jpg")[1] or ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data); tmp_paths.append(tmp.name)

    path_by_id: dict[int, str | None] = {}
    for idx, acc in enumerate(ordered):
        path_by_id[acc.id] = tmp_paths[idx] if idx < len(tmp_paths) else None

    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in ordered
    ]

    async def _do(cli, aid):
        path = path_by_id.get(aid)
        if not path:
            return "skipped", "no photo for this account"
        up = await cli.upload_file(path)
        await cli(UploadProfilePhotoRequest(file=up))
        return "ok", ""

    async def _gen():
        try:
            async for line in bulk_stream(accounts, _do):
                yield line
        finally:
            for p in tmp_paths:
                try: os.unlink(p)
                except Exception: pass

    return StreamingResponse(_gen(), media_type="application/x-ndjson")
