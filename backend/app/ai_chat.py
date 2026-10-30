"""AI-driven Telegram cat chats with Meow (@folkapp_bot).

Each selected account runs an independent background task with its own persona,
its own Vercel AI Gateway context, and its own Telegram conversation. The key
and model are configured from the dashboard and stored locally in
`<SESSIONS_DIR>/ai_gateway.json`.
"""
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import random
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, desc
from telethon.tl.functions.messages import SendReactionRequest
from telethon.tl.types import ReactionEmoji

from .db import AsyncSessionLocal
from .models import Account, AiChatMessage, AiChatProfile
from .tg_manager import manager

log = logging.getLogger("ai_chat")

GATEWAY_BASE = "https://ai-gateway.vercel.sh/v1"
# The same model is served by providers with very different prices. Without
# this pin the Gateway can route a cheap model to a provider that costs 5-6x
# more. These are the reliable low-cost endpoints for DeepSeek V4 Flash.
GATEWAY_PROVIDER_OPTIONS = {
    "gateway": {
        "only": ["runware", "deepinfra", "digitalocean", "wafer", "baseten"],
        "order": ["runware", "deepinfra", "digitalocean", "wafer", "baseten"],
    }
}
DAILY_LIMIT = 100
BD_TZ = timezone(timedelta(hours=6), "Asia/Dhaka")


def daily_reset_utc() -> datetime:
    """Return the most recent 06:00 Bangladesh time as UTC."""
    now = datetime.now(BD_TZ)
    reset = now.replace(hour=6, minute=0, second=0, microsecond=0)
    if now < reset:
        reset -= timedelta(days=1)
    return reset.astimezone(timezone.utc)


def bd_day_key() -> str:
    """Label the current 06:00-to-06:00 Bangladesh bot day."""
    return (datetime.now(BD_TZ) - timedelta(hours=6)).date().isoformat()


def _message_age_seconds(created_at) -> float:
    if not created_at:
        return 10 ** 9
    dt = created_at
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return max(0.0, (datetime.utcnow() - dt).total_seconds())


async def count_sent_today(cli, target: str) -> int:
    """Count outgoing Telegram messages to the target since the local 06:00 reset."""
    entity = await cli.get_entity(target.lstrip("@"))
    reset = daily_reset_utc()
    count = 0
    async for m in cli.iter_messages(entity, limit=1000):
        date = getattr(m, "date", None)
        if date is None:
            continue
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        if date < reset:
            break
        if getattr(m, "out", False):
            count += 1
    return count

PERSONAS = [
    {"label": "Playful", "style": "light and playful, gently teases his royal attitude and asks fun cat questions"},
    {"label": "Affectionate", "style": "warm and soft, loves giving ear scritches and checking if he ate or napped"},
    {"label": "Dramatic", "style": "matches his drama, gasps at his royal complaints, very expressive but cute"},
    {"label": "Teasing", "style": "gently teases him about being a fat royal cat, never mean and always fond"},
    {"label": "Calm", "style": "calm and cozy, soft gentle energy, slow and soothing"},
    {"label": "Chaotic", "style": "chaotic and funny, reacts to everything he knocks over and every mrow"},
    {"label": "Cat person", "style": "obsessed with cats, asks about his whiskers, paws, purrs and naps"},
    {"label": "Snack dealer", "style": "always talking about treats, food and the sound of the food bag"},
    {"label": "Sleepy", "style": "sleepy and cozy, loves nap talk and slow cuddly messages"},
    {"label": "Curious", "style": "curious about his day, his royal rules and what goes on in his cat brain"},
    {"label": "Polite", "style": "calls him your majesty, takes his royal rules very seriously and is very polite"},
    {"label": "Brief", "style": "very short, dry, funny one-liners to a dramatic cat"},
]

STYLE_TWISTS = [
    "mostly lowercase",
    "occasionally says mrow or mrp back",
    "calls him your majesty or sir",
    "asks about the red dot",
    "talks about treats",
    "teases his royal attitude",
    "reacts dramatically to his complaints",
    "asks about his naps",
    "mentions the plant he threatens",
    "keeps messages very short",
    "uses one cute emoji sometimes",
    "sounds sleepy",
    "asks what he knocked off the table",
    "says purr or headbutt",
    "calls him a fat orange king",
    "asks about his whiskers",
    "acts like his loyal subject",
    "wonders what goes on in his cat brain",
    "asks if the food bag sound woke him",
    "sounds delighted by his drama",
]

TOPICS = [
    "snacks and treat time",
    "naps and the best sleeping spots",
    "the red dot and favorite toys",
    "his royal rules for the house",
    "things he knocks off the table",
    "his day and moods",
    "the plant he keeps threatening",
    "ear scritches and purring",
    "the food bag sound",
    "his royal we and dramatic complaints",
    "sitting on the laptop",
    "his opinion on the vacuum",
]

REACTION_EMOJIS = ["❤️", "👍", "🔥", "😂", "🤔", "👏", "😮"]

TURN_STYLES = [
    "ask what he is doing right now",
    "react to his last mrow and ask one thing",
    "tease him gently and ask about his day",
    "ask about snacks or treats",
    "ask about his nap",
    "ask what he knocked over today",
    "act like his royal subject",
    "ask about the red dot",
    "ask about the plant",
    "be sleepy and cozy",
    "ask if he got enough ear scritches",
    "ask what he wants from the kitchen",
    "sound delighted by his drama",
    "ask one cute cat question and stop",
]

LENGTH_HINTS = {
    "tiny": "One very short line only. Under 6 words. No second sentence.",
    "short": "One short line only. Under 10 words. No second sentence.",
    "medium": "One short sentence, under 80 characters.",
    "long": "One or two short sentences, under 120 characters. Rare.",
}

LENGTH_LIMITS = {
    "tiny": 50,
    "short": 90,
    "medium": 130,
    "long": 170,
}

CAT_QUESTIONS = {
    "English": [
        "did you get your treats, or are we still in negotiations?",
        "is the red dot behaving today?",
        "how many naps is too many naps?",
        "did the food bag betray you again?",
        "what's the royal plan for tonight?",
        "did you sit on the laptop again?",
        "how's the plant holding up?",
        "did you get enough ear scritches?",
        "is the vacuum still your enemy?",
        "what's the best sleeping spot today?",
        "did you knock anything off the table?",
        "are you the boss of the house?",
        "did you have a good nap?",
        "what do you want from the kitchen?",
        "did you win the red dot battle?",
        "treats?",
        "nap?",
        "red dot?",
        "plant?",
        "food?",
        "vacuum?",
        "laptop?",
    ],
    "Banglish": [
        "aj treats pacho toh, raja?",
        "red dot ta ki aj bhalo behave korche?",
        "aj koybar ghumali?",
        "food bag er shobde abar ghuma bhangeche?",
        "aj raat er royal plan ki?",
        "laptop er upor abar boshechho?",
        "plant ta kemon ache?",
        "ear scritch pacho toh?",
        "vacuum ta ki ekhono enemy?",
        "ajker best ghum er jayga kothay?",
        "table theke ki felsoni?",
        "tumi ki barir boss?",
        "bhalo ghum holo?",
        "kitchen theke ki chao?",
        "red dot battle e jitso?",
        "treats pacho?",
        "ghum holo?",
        "red dot?",
        "plant?",
        "khabar?",
        "vacuum?",
        "laptop?",
    ],
}


def _local_cat_question(language: str, own: list[str], max_chars: int | None = None) -> str:
    pool = CAT_QUESTIONS.get(language, CAT_QUESTIONS["English"])
    used = " ".join((t or "").lower() for t in own)
    fresh = [q for q in pool if q.lower() not in used] or pool
    if max_chars is not None:
        fit = [q for q in fresh if len(q) <= max_chars]
        if fit:
            return random.choice(fit)
        return min(fresh, key=len)
    return random.choice(fresh)


def _first_complete_sentence(text: str) -> str:
    m = re.match(r"^(.*?[.?!])(?:\s|$)", text or "", re.S)
    return m.group(1).strip() if m else ""

FALLBACK_REPLY = "Hmm, can you explain a bit more about how this works?"

SYSTEM_PROMPT = """You are {name}, a human texting Meow, a fat dramatic orange cat who thinks he is royalty.
Style: {style}. Write only in {language}.
Reply with one short casual line (max 10 words) and one short cat question. Be human, indirect, sometimes a tiny personal detail, never AI or survey. Call him fluffy or your majesty. No em dash, no markdown, one message.
{length_hint}
Tone: {turn_style}
LANGUAGE LOCK: {language}."""


class GatewayError(Exception):
    def __init__(self, message: str, status: int = 0, permanent: bool = False):
        super().__init__(message)
        self.status = status
        self.permanent = permanent


def _gateway_request(method: str, path: str, api_key: str, payload: dict | None = None,
                     timeout: float = 45.0) -> dict:
    url = GATEWAY_BASE + path
    if payload is not None and payload.get("model") and "providerOptions" not in payload:
        payload = {**payload, "providerOptions": GATEWAY_PROVIDER_OPTIONS}
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", errors="replace")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        message = body
        try:
            parsed = json.loads(body)
            message = (
                parsed.get("error", {}).get("message")
                if isinstance(parsed.get("error"), dict)
                else parsed.get("error") or parsed.get("message") or body
            )
        except Exception:
            pass
        permanent = e.code in (401, 403, 404)
        raise GatewayError(str(message)[:400], e.code, permanent) from None
    except Exception as e:
        raise GatewayError(f"Cannot reach Vercel AI Gateway: {e}", 0, False) from None


async def validate_gateway(api_key: str, model: str) -> None:
    # The models endpoint is public, so validate with one tiny completion. This
    # is the only reliable way to confirm the key is accepted.
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 16,
        "reasoning": {"enabled": False},
    }
    await asyncio.to_thread(_gateway_request, "POST", "/chat/completions", api_key, payload, 30.0)


def _clean_ai_text(text: str, max_len: int = 190) -> str:
    if not isinstance(text, str):
        text = str(text or "")
    text = text.strip()
    text = re.sub(r"^(me|assistant|user|reply)\s*:\s*", "", text, flags=re.I)
    text = text.strip().strip('"').strip("'").strip("`").strip()
    text = re.sub(r"\s*[—–]\s*", ", ", text)
    text = text.replace("**", "").replace("__", "")
    text = re.sub(r"\s*\n+\s*", " ", text)
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"\s+([,.!?])", r"\1", text)
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) > max_len:
        window = text[:max_len]
        pos = max(window.rfind(". "), window.rfind("? "), window.rfind("! "))
        if pos >= int(max_len * 0.4):
            return window[:pos + 1].strip()
        comma = text[:max_len].rfind(", ")
        if comma >= int(max_len * 0.45):
            return (text[:comma].rstrip() + ".").strip()
        space = text[:max_len].rfind(" ")
        if space > 0:
            return (text[:space].rstrip(" ,;:") + ".").strip()
    return text.strip()


def _media_label(msg) -> str | None:
    media = getattr(msg, "media", None)
    if media is None:
        return None
    t = type(media).__name__
    if "Photo" in t:
        return "[photo]"
    if "Document" in t:
        doc = getattr(media, "document", None)
        mime = getattr(doc, "mime_type", "") or ""
        if "image" in mime:
            return "[image]"
        if "video" in mime:
            return "[video]"
        if "audio" in mime:
            return "[audio]"
        return "[file]"
    if "Poll" in t:
        return "[poll]"
    if "Geo" in t:
        return "[location]"
    if "Contact" in t:
        return "[contact]"
    return "[media]"


def _message_text(msg) -> str:
    text = (getattr(msg, "message", None) or "").strip()
    return text or (_media_label(msg) or "")


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


META_REWRITE_RE = re.compile(
    r"rewrit|paste the exact|which message|i can.t see the earlier|"
    r"give you a .*version|want rewritten|the text you want",
    re.I,
)

BAD_ROLE_RE = re.compile(
    r"your account|do you need help|"
    r"what do you need help with|tomar account|tomake ki help",
    re.I,
)

BANGLISH_RE = re.compile(
    r"\b(ami|amar|amake|tumi|tomar|apni|kore|korbo|korchi|kivabe|kemon|bhai|ache|ase|"
    r"hobe|hoy|na|nai|bujh|bujhte|kotha|bolo|bolen|tai|ki|keno|valo|bhalo|onek|ekta|"
    r"jodi|tahole|tobe|kintu|kore|dibo|bolbo|janina|jani|parbo|parchi|parsi)\b",
    re.I,
)


def _language_ok(text: str, language: str) -> bool:
    if len((text or "").strip()) < 25:
        return True
    has_bengali_script = bool(re.search(r"[\u0980-\u09FF]", text or ""))
    markers = len(BANGLISH_RE.findall(text or ""))
    if language == "Banglish":
        return has_bengali_script or markers >= 1
    return not has_bengali_script and markers == 0


BOT_LIMIT_RE = re.compile(
    r"(daily limit|100 texts today|sent me 100|pausing until)",
    re.I,
)


def _is_limit_message(text: str) -> bool:
    return bool(BOT_LIMIT_RE.search(text or ""))


class AIChatManager:
    def __init__(self):
        self._tasks: dict[int, asyncio.Task] = {}
        self._stops: dict[int, asyncio.Event] = {}
        self._state: dict[int, dict] = {}
        # AI calls are cheap but not free; this only limits simultaneous Gateway
        # calls. Every account still has its own task, profile and conversation.
        self._ai_sem = asyncio.Semaphore(10)
        # Avoid a burst of 100+ Telegram history requests when a big fill starts.
        self._init_sem = asyncio.Semaphore(15)
        # Every account runs together, but messages leave at a steady pace so
        # Meow is not hit by a 100+ message burst at the same second.
        self._send_lock = asyncio.Lock()
        self._last_send_at = 0.0

    # ---------- profiles ----------
    def _make_profile(self, account: Account) -> dict:
        key = f"{account.id}|{account.phone}|{account.tg_user_id}|{account.username}|{account.first_name}"
        digest = hashlib.sha256(key.encode("utf-8")).digest()
        a = int.from_bytes(digest[0:4], "big")
        b = int.from_bytes(digest[4:8], "big")
        c = int.from_bytes(digest[8:12], "big")
        base = dict(PERSONAS[a % len(PERSONAS)])
        twist = STYLE_TWISTS[b % len(STYLE_TWISTS)]
        language = "Banglish" if digest[15] % 100 < 42 else "English"
        topic = TOPICS[c % len(TOPICS)]
        return {
            "label": base["label"],
            "style": f"{base['style']}, {twist}",
            "language": language,
            "topic": topic,
        }

    def persona_for(self, account: Account) -> dict:
        if not account:
            return dict(PERSONAS[0])
        return self._make_profile(account)

    async def get_profile(self, account: Account) -> dict:
        async with AsyncSessionLocal() as db:
            row = await db.scalar(
                select(AiChatProfile).where(AiChatProfile.account_id == account.id)
            )
            if row:
                if row.topic not in TOPICS:
                    # Character update: existing accounts still have old research
                    # profiles. Rebuild the persona and topic for Meow, keep the
                    # language so the English/Banglish split stays.
                    data = self._make_profile(account)
                    row.persona = data["label"]
                    row.style = data["style"]
                    row.topic = data["topic"]
                    row.reset_at = datetime.utcnow()
                    await db.commit()
                if row.reset_at is None:
                    row.reset_at = datetime.utcnow()
                    await db.commit()
                return {
                    "label": row.persona,
                    "style": row.style,
                    "language": row.language,
                    "topic": row.topic,
                    "reset_at": row.reset_at,
                }
            data = self._make_profile(account)
            now = datetime.utcnow()
            db.add(AiChatProfile(
                account_id=account.id,
                persona=data["label"],
                style=data["style"],
                language=data["language"],
                topic=data["topic"],
                reset_at=now,
            ))
            await db.commit()
            data["reset_at"] = now
            return data

    def _set(self, account_id: int, **kw):
        cur = self._state.setdefault(account_id, {})
        cur.update(kw)
        cur["last_activity"] = kw.get("last_activity", cur.get("last_activity") or _now_iso())

    def snapshot(self) -> dict[int, dict]:
        return {aid: dict(st) for aid, st in self._state.items()}

    def running_ids(self) -> list[int]:
        return [aid for aid, st in self._state.items() if st.get("running")]

    def active_ids(self) -> list[int]:
        return [
            aid for aid, st in self._state.items()
            if st.get("running") and st.get("status") != "queued"
        ]

    def mark_daily(self, account_id: int, daily_sent: int, daily_limit: int = DAILY_LIMIT,
                   status: str = "completed", last_error: str = ""):
        if self.is_running(account_id):
            return
        self._state[account_id] = {
            "running": False,
            "status": status,
            "daily_sent": max(0, int(daily_sent or 0)),
            "daily_limit": max(0, int(daily_limit or 0)),
            "fill_daily": True,
            "turns_done": 0,
            "turn_target": 0,
            "last_error": last_error,
            "started_at": _now_iso(),
            "last_activity": _now_iso(),
        }

    async def _mark_limit_reached(self, account_id: int):
        day = bd_day_key()
        try:
            async with AsyncSessionLocal() as db:
                prof = await db.scalar(
                    select(AiChatProfile).where(AiChatProfile.account_id == account_id)
                )
                if prof:
                    prof.limit_day = day
                    await db.commit()
        except Exception as e:
            log.warning("could not save daily limit for %s: %s", account_id, e)

    def is_running(self, account_id: int) -> bool:
        task = self._tasks.get(account_id)
        return bool(task and not task.done())

    # ---------- start / stop ----------
    async def start(self, account: Account, api_key: str, model: str, target: str,
                    min_turns: int = 4, max_turns: int = 10,
                    fixed_target: int | None = None, skip_start: bool = False,
                    daily_sent: int = 0, daily_limit: int = 0,
                    fill_daily: bool = False) -> bool:
        aid = account.id
        if self.is_running(aid):
            return False
        stop = asyncio.Event()
        profile = await self.get_profile(account)
        lo = max(1, min(int(min_turns or 4), 500))
        hi = max(lo, min(int(max_turns or 10), 500))
        if fixed_target is None:
            turn_target = random.randint(lo, hi)
        else:
            turn_target = max(0, min(int(fixed_target), DAILY_LIMIT))
        if turn_target <= 0:
            return False
        self._state[aid] = {
            "running": True,
            "status": "starting",
            "persona": profile["label"],
            "language": profile["language"],
            "topic": profile["topic"],
            "turns_done": 0,
            "turn_target": turn_target,
            "daily_sent": max(0, int(daily_sent or 0)),
            "daily_limit": max(0, int(daily_limit or 0)),
            "fill_daily": bool(fill_daily),
            "last_error": "",
            "started_at": _now_iso(),
            "last_activity": _now_iso(),
        }
        task = asyncio.create_task(
            self._run(
                account, api_key, model, target, stop, profile, turn_target,
                skip_start=skip_start, daily_sent=int(daily_sent or 0),
            ),
            name=f"ai-chat-{aid}",
        )
        self._tasks[aid] = task
        self._stops[aid] = stop
        task.add_done_callback(lambda t, a=aid: self._finished(a, t))
        return True

    def _finished(self, account_id: int, task: asyncio.Task):
        self._tasks.pop(account_id, None)
        self._stops.pop(account_id, None)
        st = self._state.get(account_id)
        if st and st.get("running"):
            if task.cancelled():
                self._set(account_id, running=False, status="stopped")
            else:
                try:
                    exc = task.exception()
                except Exception:
                    exc = None
                if exc:
                    self._set(account_id, running=False, status="error", last_error=str(exc)[:300])
                else:
                    self._set(account_id, running=False, status="stopped")

    async def stop(self, account_ids: list[int] | None = None) -> list[int]:
        ids = list(account_ids) if account_ids else list(self._tasks.keys())
        stopped: list[int] = []
        for aid in ids:
            ev = self._stops.get(aid)
            if ev:
                ev.set()
            task = self._tasks.get(aid)
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    pass
            self._tasks.pop(aid, None)
            self._stops.pop(aid, None)
            if aid in self._state:
                self._set(aid, running=False, status="stopped")
            stopped.append(aid)
        return stopped

    async def shutdown(self):
        await self.stop(None)

    # ---------- worker ----------
    async def _run(self, account: Account, api_key: str, model: str, target: str,
                   stop: asyncio.Event, profile: dict, turn_target: int,
                   skip_start: bool = False, daily_sent: int = 0):
        aid = account.id
        self._set(aid, status="starting", last_activity=_now_iso())
        await self._sleep_or_stop(stop, random.uniform(0, 45))
        if stop.is_set():
            self._set(aid, running=False, status="stopped", last_activity=_now_iso())
            return
        await self._run_inner(
            account, api_key, model, target, stop, profile, turn_target,
            skip_start=skip_start, daily_sent=daily_sent,
        )

    async def _run_inner(self, account: Account, api_key: str, model: str, target: str,
                         stop: asyncio.Event, profile: dict, turn_target: int,
                         skip_start: bool = False, daily_sent: int = 0):
        aid = account.id
        name = (account.first_name or "").strip() or f"user {aid}"
        turns_done = 0
        loop = asyncio.get_running_loop()
        next_send_at = loop.time() + random.uniform(10, 25)
        try:
            cli = manager.get(aid)
            if not cli or not cli.is_connected():
                raise RuntimeError("Account is not connected")
            async with self._init_sem:
                entity = await cli.get_entity(target.lstrip("@"))
                await self._seed_history(cli, entity, aid, profile.get("reset_at"))
            history = await self._load_history(aid, 24, profile.get("reset_at"))
            force_first = False
            if not any(m.direction == "me" for m in history):
                if skip_start:
                    # Daily fill must not spend one of the remaining messages on
                    # /start, and many accounts have never opened this chat.
                    force_first = True
                    next_send_at = loop.time() + random.uniform(2, 6)
                else:
                    sent = await self._send_paced(cli, entity, "/start")
                    await self._persist(aid, "me", "/start", sent.id)
                    self._set(aid, status="waiting", last_activity=_now_iso())
                    next_send_at = loop.time() + random.uniform(10, 25)
                    await self._wait_for_bot(aid, cli, entity, sent.id, stop, timeout=20)
                    history = await self._load_history(aid, 24, profile.get("reset_at"))
                    if not any(m.direction == "bot" for m in history):
                        # Some bots do not send a fresh welcome on /start. Send one
                        # cat greeting anyway so the chat is not stuck forever.
                        force_first = True
                        next_send_at = loop.time()

            if history and history[-1].direction == "me":
                if _message_age_seconds(history[-1].created_at) >= 90:
                    # A previous run may have stopped after sending without a
                    # reply. Waiting for a reply to that old message is what made
                    # fill jobs sit forever, so start a fresh turn instead.
                    force_first = True
                    next_send_at = loop.time() + random.uniform(5, 12)
                    self._set(aid, status="starting", last_error="", last_activity=_now_iso())

            consecutive_errors = 0
            bot_timeouts = 0
            limit_reached = False
            stop_note = ""
            while not stop.is_set():
                if turns_done >= turn_target:
                    break

                history = await self._load_history(aid, 24, profile.get("reset_at"))
                if not history and not force_first:
                    await self._sleep_or_stop(stop, 5)
                    continue

                last = history[-1] if history else None
                if last and last.direction == "bot" and _is_limit_message(last.text):
                    await self._mark_limit_reached(aid)
                    limit_reached = True
                    stop_note = "Daily limit reached. Skipping this account until the next reset."
                    break
                if last and last.direction == "me" and not force_first:
                    self._set(aid, status="waiting", last_activity=_now_iso())
                    after = last.tg_msg_id or 0
                    got = await self._wait_for_bot(aid, cli, entity, after, stop, timeout=120)
                    if stop.is_set():
                        break
                    if not got:
                        bot_timeouts += 1
                        if bot_timeouts >= 2:
                            await self._mark_limit_reached(aid)
                            limit_reached = True
                            stop_note = "Daily limit reached. Skipping this account until the next reset."
                            break
                        self._set(aid, status="waiting", last_error="", last_activity=_now_iso())
                        await self._sleep_or_stop(stop, 15)
                        continue
                    bot_timeouts = 0
                    history = await self._load_history(aid, 24, profile.get("reset_at"))
                    last = history[-1] if history else None
                    if not last:
                        continue

                if last and last.direction != "bot" and not force_first:
                    await self._sleep_or_stop(stop, 5)
                    continue

                if force_first:
                    force_first = False
                    if skip_start:
                        self._set(aid, status="starting", last_error="", last_activity=_now_iso())
                        await self._sleep_or_stop(stop, random.uniform(5, 12))
                        if stop.is_set():
                            break
                else:
                    # Human gap between messages. The bot may send more while we wait.
                    wait = next_send_at - loop.time()
                    if wait > 0:
                        self._set(aid, status="waiting", last_activity=_now_iso())
                        await self._sleep_or_stop(stop, wait)
                        if stop.is_set():
                            break
                        await self._wait_for_bot(
                            aid, cli, entity, last.tg_msg_id or 0, stop, timeout=2.0,
                        )
                        history = await self._load_history(aid, 24, profile.get("reset_at"))
                        last = history[-1] if history else None
                        if not last or last.direction != "bot":
                            continue

                # Read the reply and pause like a person before answering.
                self._set(aid, status="reading", last_error="", last_activity=_now_iso())
                await self._mark_read(cli, entity)
                await self._sleep_or_stop(stop, random.uniform(1.0, 3.0))
                if stop.is_set():
                    break
                if random.random() < 0.05:
                    await self._sleep_or_stop(stop, random.uniform(3.0, 8.0))
                    if stop.is_set():
                        break

                if last and last.direction == "bot" and last.tg_msg_id and random.random() < 0.18:
                    emoji = random.choice(REACTION_EMOJIS)
                    if await self._react(cli, entity, last.tg_msg_id, emoji):
                        await self._set_reaction(aid, last.tg_msg_id, emoji)

                length_mode = self._length_mode(profile)
                try:
                    self._set(aid, status="thinking", last_activity=_now_iso())
                    reply = await self._generate_reply(
                        api_key, model, target, name, profile, history, length_mode,
                    )
                    consecutive_errors = 0
                except GatewayError as e:
                    consecutive_errors += 1
                    self._set(aid, status="error", last_error=str(e)[:300], last_activity=_now_iso())
                    if e.permanent or consecutive_errors >= 3:
                        break
                    await self._sleep_or_stop(stop, 15)
                    continue
                except Exception as e:
                    consecutive_errors += 1
                    self._set(aid, status="error", last_error=str(e)[:300], last_activity=_now_iso())
                    if consecutive_errors >= 3:
                        break
                    await self._sleep_or_stop(stop, 15)
                    continue

                if not reply:
                    consecutive_errors += 1
                    self._set(aid, status="error", last_error="The AI returned an empty reply", last_activity=_now_iso())
                    if consecutive_errors >= 3:
                        break
                    await self._sleep_or_stop(stop, 15)
                    continue

                self._set(aid, status="typing", last_error="", last_activity=_now_iso())
                await self._human_delay(cli, entity, stop, reply, length_mode)
                if stop.is_set():
                    break

                # Sometimes quote the bot's last message, like a real reply.
                quote = bool(last and last.direction == "bot" and last.tg_msg_id and random.random() < 0.34)
                reply_to = last.tg_msg_id if quote else None
                try:
                    sent = await self._send_paced(cli, entity, reply, reply_to=reply_to)
                except Exception:
                    # The quoted message may have been deleted; send plain text.
                    quote = False
                    sent = await self._send_paced(cli, entity, reply)
                await self._persist(aid, "me", reply, sent.id,
                                    reply_to_text=last.text if quote and last else None)
                turns_done += 1
                daily_sent += 1
                next_send_at = loop.time() + random.uniform(8, 22)
                self._set(
                    aid, turns_done=turns_done, daily_sent=daily_sent,
                    status="waiting", last_activity=_now_iso(),
                )

                got = await self._wait_for_bot(aid, cli, entity, sent.id, stop, timeout=120)
                if stop.is_set():
                    break
                if got:
                    bot_timeouts = 0
                    await self._sleep_or_stop(stop, random.uniform(0.8, 1.8))
                else:
                    bot_timeouts += 1
                    if bot_timeouts >= 2:
                        await self._mark_limit_reached(aid)
                        limit_reached = True
                        stop_note = "Daily limit reached. Skipping this account until the next reset."
                        break
                    await self._sleep_or_stop(stop, 10)

            if turns_done >= turn_target:
                final_status = "completed"
                stop_note = ""
            elif limit_reached:
                final_status = "limit"
            elif stop_note:
                final_status = "error"
            else:
                final_status = "stopped"
            current_error = self._state.get(aid, {}).get("last_error") or ""
            self._set(
                aid, running=False, status=final_status,
                last_error=stop_note or ("" if final_status == "completed" else current_error),
                last_activity=_now_iso(),
            )
        except asyncio.CancelledError:
            self._set(aid, running=False, status="stopped", last_activity=_now_iso())
            raise
        except Exception as e:
            log.warning("ai chat %s stopped: %s", aid, e)
            self._set(aid, running=False, status="error", last_error=str(e)[:300], last_activity=_now_iso())

    async def _send_paced(self, cli, entity, text: str, reply_to=None):
        loop = asyncio.get_running_loop()
        async with self._send_lock:
            wait = self._last_send_at + 0.32 - loop.time()
            if wait > 0:
                await asyncio.sleep(wait)
            sent = await cli.send_message(entity, text, reply_to=reply_to)
            self._last_send_at = loop.time()
            return sent

    async def _mark_read(self, cli, entity):
        try:
            await cli.send_read_acknowledge(entity)
        except Exception:
            pass

    async def _react(self, cli, entity, msg_id: int, emoji: str) -> bool:
        try:
            await cli(SendReactionRequest(
                peer=entity,
                msg_id=msg_id,
                reaction=[ReactionEmoji(emoticon=emoji)],
            ))
            return True
        except Exception:
            return False

    async def _set_reaction(self, account_id: int, tg_msg_id: int, emoji: str):
        try:
            async with AsyncSessionLocal() as db:
                row = await db.scalar(
                    select(AiChatMessage).where(
                        AiChatMessage.account_id == account_id,
                        AiChatMessage.tg_msg_id == tg_msg_id,
                    )
                )
                if row:
                    row.reaction = emoji
                    await db.commit()
        except Exception:
            pass

    def _length_mode(self, profile: dict) -> str:
        if profile.get("label") == "Brief":
            return "tiny" if random.random() < 0.7 else "short"
        r = random.random()
        if r < 0.35:
            return "tiny"
        if r < 0.8:
            return "short"
        if r < 0.98:
            return "medium"
        return "long"

    async def _human_delay(self, cli, entity, stop: asyncio.Event, text: str = "",
                           length_mode: str = "short"):
        # Short gap, then a believable but quick typing duration.
        await self._sleep_or_stop(stop, random.uniform(0.3, 1.2))
        base = {
            "tiny": random.uniform(1.0, 2.2),
            "short": random.uniform(1.2, 3.0),
            "medium": random.uniform(2.5, 5.0),
            "long": random.uniform(4.0, 7.0),
        }.get(length_mode, random.uniform(1.2, 3.0))
        seconds = min(10.0, base + min(2.0, len(text or "") / 70.0))
        try:
            async with cli.action(entity, "typing"):
                await self._sleep_or_stop(stop, seconds)
        except Exception:
            await self._sleep_or_stop(stop, seconds)

    async def _sleep_or_stop(self, stop: asyncio.Event, seconds: float):
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    # ---------- Telegram history ----------
    async def _seed_history(self, cli, entity, account_id: int, reset_at=None):
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(AiChatMessage.tg_msg_id).where(
                    AiChatMessage.account_id == account_id,
                    AiChatMessage.tg_msg_id.is_not(None),
                )
            )
            seen = {row[0] for row in res.all()}
        msgs = []
        async for m in cli.iter_messages(entity, limit=30):
            msgs.append(m)
        msgs.reverse()
        for m in msgs:
            if m.id in seen:
                continue
            if reset_at is not None and getattr(m, "date", None) is not None:
                msg_dt = m.date.replace(tzinfo=None)
                if msg_dt < reset_at:
                    continue
            text = _message_text(m)
            if not text:
                continue
            direction = "me" if getattr(m, "out", False) else "bot"
            await self._persist(account_id, direction, text, m.id)

    async def _load_history(self, account_id: int, limit: int = 24, reset_at=None):
        async with AsyncSessionLocal() as db:
            q = select(AiChatMessage).where(AiChatMessage.account_id == account_id)
            if reset_at is not None:
                q = q.where(AiChatMessage.created_at >= reset_at)
            q = q.order_by(desc(AiChatMessage.id)).limit(max(2, min(limit, 400)))
            res = await db.execute(q)
            rows = list(res.scalars().all())
        rows.reverse()
        return rows

    async def _persist(self, account_id: int, direction: str, text: str,
                       tg_msg_id: int | None = None, reply_to_text: str | None = None):
        text = (text or "").strip()
        if not text:
            return
        async with AsyncSessionLocal() as db:
            if tg_msg_id is not None:
                exists = await db.scalar(
                    select(AiChatMessage.id).where(
                        AiChatMessage.account_id == account_id,
                        AiChatMessage.tg_msg_id == tg_msg_id,
                    )
                )
                if exists:
                    return
            db.add(AiChatMessage(
                account_id=account_id,
                direction=direction,
                text=text,
                tg_msg_id=tg_msg_id,
                reply_to_text=reply_to_text,
                created_at=datetime.utcnow(),
            ))
            await db.commit()

    async def _wait_for_bot(self, account_id: int, cli, entity, after_id: int,
                            stop: asyncio.Event, timeout: float = 120.0) -> bool:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        got = False
        quiet_until = 0.0
        while not stop.is_set() and loop.time() < deadline:
            found = 0
            batch: list[tuple[int, str]] = []
            async for m in cli.iter_messages(entity, min_id=max(0, after_id), limit=20):
                if getattr(m, "out", False) or m.id <= after_id:
                    continue
                text = _message_text(m)
                if not text:
                    continue
                batch.append((m.id, text))
            # Telegram returns newest first; persist oldest first so the transcript
            # and the AI context keep the real order.
            for mid, text in sorted(batch, key=lambda x: x[0]):
                await self._persist(account_id, "bot", text, mid)
                after_id = max(after_id, mid)
                found += 1
                got = True
                self._set(account_id, status="reading", last_activity=_now_iso())
            if found:
                quiet_until = loop.time() + 1.5
            elif got and loop.time() >= quiet_until:
                return True
            # Do not hammer Telegram with one history request per second per
            # account. Many accounts run at the same time.
            await self._sleep_or_stop(stop, 2.5)
        return got

    # ---------- AI ----------
    async def _rewrite_message(self, text: str, language_name: str, max_len: int,
                               api_key: str, model: str) -> str:
        if language_name == "Banglish":
            target_lang = ("casual Banglish, Romanized Bengali mixed with English, "
                           "the way a Bangladeshi person texts. No Bengali script and not plain English")
        else:
            target_lang = "casual natural English only. No Bengali words or script"
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": (
                    "You rewrite the message inside the tags. Return only the rewritten text. "
                    "Never ask for the message, never mention rewriting, and never add an explanation."
                )},
                {"role": "user", "content": (
                    f"Rewrite this message in {target_lang}. Keep the same meaning and tone. "
                    f"Make it complete and natural, at most {max_len} characters, one or two short "
                    f"sentences. No quotes, no em dash, no markdown.\n\n"
                    f"<message>{text}</message>"
                )},
            ],
            "temperature": 0.3,
            "max_tokens": 260,
            "reasoning": {"enabled": False},
        }
        async with self._ai_sem:
            data = await asyncio.to_thread(
                _gateway_request, "POST", "/chat/completions", api_key, payload, 45.0,
            )
        choice = (data.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content")
        if isinstance(content, list):
            content = " ".join(
                b.get("text", "") for b in content if isinstance(b, dict)
            )
        if not isinstance(content, str):
            return ""
        cleaned = _clean_ai_text(content, max_len + 20)
        if not cleaned or META_REWRITE_RE.search(cleaned):
            return ""
        return cleaned

    async def _followup_question(self, draft: str, last_bot: str, profile: dict,
                                 language_name: str, own: list[str], api_key: str,
                                 model: str) -> str:
        if language_name == "Banglish":
            target_lang = ("casual Banglish, Romanized Bengali mixed with English, "
                           "the way a Bangladeshi person texts. No Bengali script and not plain English")
        else:
            target_lang = "casual natural English only. No Bengali words or script"
        earlier = "\n".join(f"- {t[:120]}" for t in own[-3:]) or "(none)"
        examples = (
            "Aj treats pacho toh, raja?"
            if language_name == "Banglish"
            else "Did you get your treats today, your majesty?"
        )
        prompts = [
            (
                f"Write one natural follow-up question in {target_lang}.\n"
                f"Cat chat topic: {profile.get('topic') or 'snacks, naps and royal cat life'}\n"
                f"Meow's last message: {(last_bot or '')[:350]}\n"
                f"Draft reply: {draft}\n"
                f"Do not repeat earlier questions from me:\n{earlier}\n"
                "Ask Meow a cute question about his snacks, naps, toys, what he knocked over, "
                "or his royal cat life. Talk to him like a real cat, never about accounts, "
                f"support or tasks. Example: {examples} Under 80 characters."
            ),
            (
                f"Write one short question in {target_lang} that a human would ask Meow, "
                f"a dramatic orange cat, about {profile.get('topic') or 'snacks, naps and toys'}. "
                f"Example: {examples} Return only the question, under 70 characters."
            ),
        ]
        for prompt in prompts:
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": (
                        "Return only one short follow-up question for a cute cat chat. No explanation, "
                        "no quotes, no em dash, no markdown. The question must be about Meow's cat life "
                        "and must end with a question mark."
                    )},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.85,
                "max_tokens": 140,
                "reasoning": {"enabled": False},
            }
            try:
                async with self._ai_sem:
                    data = await asyncio.to_thread(
                        _gateway_request, "POST", "/chat/completions", api_key, payload, 45.0,
                    )
            except Exception:
                continue
            choice = (data.get("choices") or [{}])[0]
            content = (choice.get("message") or {}).get("content")
            if isinstance(content, list):
                content = " ".join(b.get("text", "") for b in content if isinstance(b, dict))
            if not isinstance(content, str):
                continue
            q = _clean_ai_text(content, 90)
            if q and "?" in q and _language_ok(q, language_name) and not BAD_ROLE_RE.search(q):
                return q
        return ""

    async def _generate_reply(self, api_key: str, model: str, target: str, name: str,
                              profile: dict, history: list[AiChatMessage],
                              length_mode: str = "short") -> str:
        language_name = profile.get("language") or "English"
        if language_name == "Banglish":
            language = "casual Banglish (Romanized Bengali + English), no Bengali script"
        else:
            language = "casual English only"
        length_hint = LENGTH_HINTS.get(length_mode, LENGTH_HINTS["short"])
        max_len = LENGTH_LIMITS.get(length_mode, LENGTH_LIMITS["medium"])
        max_tokens = {"tiny": 30, "short": 40, "medium": 50, "long": 60}.get(length_mode, 40)
        base_system = SYSTEM_PROMPT.format(
            name=name,
            target=target if target.startswith("@") else "@" + target,
            style=profile.get("style") or "natural and casual",
            topic=profile.get("topic") or "snacks, naps and royal cat life",
            language=language,
            length_hint=length_hint,
            turn_style=random.choice(TURN_STYLES),
        )
        own = [
            (m.text or "").strip()
            for m in history
            if m.direction == "me" and (m.text or "").strip() not in ("", "/start", FALLBACK_REPLY)
        ][-4:]

        def build_messages(limit: int, system_text: str) -> list[dict]:
            msgs = [{"role": "system", "content": system_text}]
            for m in history[-limit:]:
                role = "assistant" if m.direction == "me" else "user"
                content = (m.text or "").strip()
                if not content or content == "/start" or content == FALLBACK_REPLY:
                    continue
                msgs.append({"role": role, "content": content[:200]})
            while len(msgs) > 1 and msgs[-1].get("role") == "assistant":
                msgs.pop()
            if len(msgs) == 1 or msgs[-1].get("role") != "user":
                msgs.append({"role": "user", "content": "Hi, what can you do?"})
            return msgs

        last_error = ""
        for attempt in range(2):
            system_text = base_system
            limit = 2
            if attempt == 1:
                limit = 2
                system_text = (
                    f"You are {name}, a real person texting Meow, a dramatic orange cat. "
                    f"Write only in {language_name}. Reply in one short line under {max_len} "
                    "characters. Ask one cute question about his snacks, naps, toys or royal cat life. "
                    "Treat him as a real cat, never a bot or AI. No em dash, no markdown, no assistant tone."
                )
            messages = build_messages(limit, system_text)
            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.9 if attempt == 0 else 0.8,
                "max_tokens": max_tokens if attempt == 0 else max(max_tokens, 100),
                "reasoning": {"enabled": False},
            }
            async with self._ai_sem:
                data = await asyncio.to_thread(
                    _gateway_request, "POST", "/chat/completions", api_key, payload, 45.0,
                )
            choice = (data.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            content = message.get("content")
            if isinstance(content, list):
                parts = []
                for block in content:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        parts.append(block["text"])
                content = " ".join(parts)
            if not isinstance(content, str):
                content = ""
            cleaned = _clean_ai_text(content, max_len) if content.strip() else ""
            if cleaned:
                finish_reason = choice.get("finish_reason")
                cut = finish_reason == "length" and not cleaned.rstrip().endswith((".", "?", "!"))
                if cut:
                    # Keep the first complete sentence instead of a mid-word
                    # cut. If there is no complete sentence, use a clean local
                    # cat question.
                    first = _first_complete_sentence(cleaned)
                    if len(first) >= 10:
                        if "?" in first:
                            return first
                        q = _local_cat_question(language_name, own)
                        combined = f"{first} {q}"
                        return combined if len(combined) <= max_len + 20 else first
                    return _local_cat_question(language_name, own)
                if "?" in cleaned:
                    return cleaned
                budget = max_len + 20 - len(cleaned) - 1
                q = _local_cat_question(language_name, own, budget if budget >= 8 else None)
                combined = f"{cleaned.rstrip()} {q}"
                if len(combined) > max_len + 20:
                    return q
                return _clean_ai_text(combined, max_len + 20)
            usage = data.get("usage") or {}
            reasoning_tokens = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0
            last_error = f"finish={choice.get('finish_reason')} reasoning_tokens={reasoning_tokens}"
            log.warning("AI returned an empty reply (attempt %s, %s)", attempt + 1, last_error)
        raise GatewayError(f"The AI returned an empty reply ({last_error})", 0, False)

ai_manager = AIChatManager()
