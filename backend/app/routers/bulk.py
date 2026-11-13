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
import io
import json
import logging
import random
import re
import tempfile
import os
import zipfile

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

PHONE_COUNTRIES = {
    "880": "Bangladesh", "91": "India", "92": "Pakistan", "94": "Sri Lanka",
    "977": "Nepal", "95": "Myanmar", "971": "United Arab Emirates",
    "966": "Saudi Arabia", "974": "Qatar", "965": "Kuwait", "973": "Bahrain",
    "968": "Oman", "962": "Jordan", "961": "Lebanon", "963": "Syria",
    "964": "Iraq", "98": "Iran", "90": "Turkey", "20": "Egypt",
    "212": "Morocco", "213": "Algeria", "216": "Tunisia", "218": "Libya",
    "234": "Nigeria", "254": "Kenya", "233": "Ghana", "27": "South Africa",
    "55": "Brazil", "52": "Mexico", "54": "Argentina", "57": "Colombia",
    "56": "Chile", "51": "Peru", "58": "Venezuela", "7": "Russia",
    "380": "Ukraine", "48": "Poland", "49": "Germany", "33": "France",
    "39": "Italy", "34": "Spain", "351": "Portugal", "31": "Netherlands",
    "32": "Belgium", "41": "Switzerland", "43": "Austria", "46": "Sweden",
    "47": "Norway", "45": "Denmark", "358": "Finland", "30": "Greece",
    "81": "Japan", "82": "South Korea", "86": "China", "66": "Thailand",
    "84": "Vietnam", "62": "Indonesia", "60": "Malaysia", "63": "Philippines",
    "65": "Singapore", "1": "United States", "61": "Australia",
    "64": "New Zealand", "998": "Uzbekistan", "994": "Azerbaijan",
    "996": "Kyrgyzstan", "992": "Tajikistan", "993": "Turkmenistan",
    "972": "Israel", "353": "Ireland", "44": "United Kingdom",
}


def _normalize_name(first: str, last: str) -> str:
    return " ".join(f"{first or ''} {last or ''}".split()).strip().lower()


def _country_for_phone(phone: str | None) -> str | None:
    digits = re.sub(r"\D", "", phone or "")
    for size in (3, 2, 1):
        if len(digits) >= size and digits[:size] in PHONE_COUNTRIES:
            return PHONE_COUNTRIES[digits[:size]]
    return None


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
                               country: str, avoid_names: list[str],
                               base_url: str | None = None, provider: str | None = None):
    current = f"{account.first_name or ''} {account.last_name or ''}".strip() or "none"
    avoid = ", ".join(avoid_names[-20:]) or "none"
    system = (
        "You invent believable Telegram profile identities. Return only valid JSON, "
        "with no markdown and no explanation. Use a natural human name that fits the "
        "given country. The username must feel premium and slightly stylized, based on "
        "the name, lowercase ASCII, 10-24 characters, one optional underscore, and may "
        "use 1, 3, 4 or 7 as letter substitutes or 1-3 digits. Never return the exact "
        "plain name as the username. Give six different high-availability candidates. "
        "Every username must be visibly derived from this person's first and/or last name. "
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
        base_url=base_url, provider=provider,
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
    name_bits = [
        re.sub(r"[^a-z]", "", (part or "").lower())
        for part in (first, last)
    ]
    name_bits = [part for part in name_bits if len(part) >= 3]
    if name_bits:
        related = [u for u in usernames if any(part in u for part in name_bits)]
        if not related:
            raise ValueError("AI usernames were not derived from the generated name")
        usernames = related
    return first, last, usernames[:6]


async def _apply_ai_profile(cli, account: Account, api_key: str, model: str,
                            avoid_names: list[str], used_names: set[str],
                            name_lock: asyncio.Lock, base_url: str | None = None,
                            provider: str | None = None):
    first = last = ""
    usernames: list[str] = []
    last_error = None
    country = _country_for_phone(account.phone) or random.choice(AI_COUNTRIES)
    reserved = False
    for attempt in range(4):
        try:
            first, last, usernames = await _generate_ai_profile(
                api_key, model, account, country, avoid_names,
                base_url=base_url, provider=provider,
            )
        except Exception as e:
            last_error = e
            await asyncio.sleep(1)
            continue
        full_name = _normalize_name(first, last)
        reserved = False
        async with name_lock:
            if full_name and full_name not in used_names:
                used_names.add(full_name)
                reserved = True
            if full_name and full_name not in avoid_names:
                avoid_names.append(full_name)
                del avoid_names[:-80]
        if reserved:
            break
        await asyncio.sleep(0.2)
    if not first or not usernames or not reserved:
        raise RuntimeError(f"AI profile generation failed: {last_error or 'could not create a unique name'}")

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
        raise HTTPException(400, "Add your AI API key in Settings ? AI provider first")
    api_key = cfg["api_key"]
    model = cfg.get("model") or ai_store.DEFAULT_MODEL
    base_url = cfg.get("base_url") or ai_store.provider_base(cfg.get("provider"))
    provider = cfg.get("provider") or ai_store.PROVIDER_VERCEL

    res = await db.execute(select(Account).where(Account.id.in_(ids)))
    by_id = {a.id: a for a in res.scalars().all()}
    ordered = [by_id[i] for i in ids if i in by_id]
    accounts = [
        (a.id, a.phone, (f"{a.first_name or ''} {a.last_name or ''}".strip() or a.phone))
        for a in ordered
    ]
    name_rows = await db.execute(select(Account.first_name, Account.last_name))
    used_names = {
        _normalize_name(first, last)
        for first, last in name_rows.all()
        if _normalize_name(first, last)
    }
    avoid_names: list[str] = sorted(used_names)[-200:]
    name_lock = asyncio.Lock()

    async def _do(cli, aid):
        account = by_id.get(aid)
        if not account:
            return "skipped", "account not found"
        detail = await _apply_ai_profile(
            cli, account, api_key, model, avoid_names, used_names, name_lock,
            base_url=base_url, provider=provider,
        )
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

    A .zip upload is supported: image entries are sorted by filename and mapped
    to accounts in that order. Extra images are ignored; accounts without a photo
    are skipped. No non-image/zip-slip entries are extracted.
    """
    ids = [int(x) for x in account_ids.split(",") if x.strip()]
    res = await db.execute(select(Account).where(Account.id.in_(ids)))
    by_id = {a.id: a for a in res.scalars().all()}
    ordered = [by_id[i] for i in ids if i in by_id]

    image_exts = {".jpg", ".jpeg", ".png", ".webp"}
    max_images = 5000
    max_each = 25 * 1024 * 1024
    max_total = 1024 * 1024 * 1024
    tmp_paths: list[str] = []
    total_bytes = 0

    def _suffix(name: str) -> str:
        return os.path.splitext(name or "")[1].lower() or ".jpg"

    def _natural_key(name: str):
        return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name or "")]

    try:
        for upload in files:
            filename = upload.filename or "photo.jpg"
            if filename.lower().endswith(".zip"):
                try:
                    with zipfile.ZipFile(upload.file) as archive:
                        entries = sorted(
                            (
                                info for info in archive.infolist()
                                if not info.is_dir()
                                and not info.filename.startswith("__MACOSX/")
                                and _suffix(info.filename) in image_exts
                            ),
                            key=lambda info: _natural_key(info.filename),
                        )
                        for info in entries:
                            if len(tmp_paths) >= max_images or total_bytes >= max_total:
                                break
                            if info.file_size <= 0 or info.file_size > max_each:
                                continue
                            with archive.open(info) as src:
                                data = src.read()
                            total_bytes += len(data)
                            if total_bytes > max_total:
                                break
                            with tempfile.NamedTemporaryFile(suffix=_suffix(info.filename), delete=False) as tmp:
                                tmp.write(data)
                                tmp_paths.append(tmp.name)
                except zipfile.BadZipFile:
                    raise HTTPException(400, f"{filename} is not a valid ZIP file")
                continue
            data = await upload.read()
            if not data or len(data) > max_each or len(tmp_paths) >= max_images:
                continue
            total_bytes += len(data)
            if total_bytes > max_total:
                break
            with tempfile.NamedTemporaryFile(suffix=_suffix(filename), delete=False) as tmp:
                tmp.write(data)
                tmp_paths.append(tmp.name)

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
                    try:
                        os.unlink(p)
                    except Exception:
                        pass

        return StreamingResponse(_gen(), media_type="application/x-ndjson")
    except HTTPException:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except Exception:
                pass
        raise
    except Exception:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except Exception:
                pass
        raise
