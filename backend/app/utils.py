"""Helpers for bulk action delays and FloodWait handling."""
import asyncio
import random
from telethon.errors import FloodWaitError
from .config import settings


async def jitter_delay(min_s: float | None = None, max_s: float | None = None):
    lo = min_s if min_s is not None else settings.RATE_MIN
    hi = max_s if max_s is not None else settings.RATE_MAX
    if hi < lo:
        hi = lo
    await asyncio.sleep(random.uniform(lo, hi))


def friendly_error(e: Exception) -> str:
    if isinstance(e, FloodWaitError):
        return f"FloodWait: wait {e.seconds}s"
    return f"{type(e).__name__}: {str(e)[:140]}"
