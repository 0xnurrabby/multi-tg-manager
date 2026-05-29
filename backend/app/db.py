from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from .config import settings


class Base(DeclarativeBase):
    pass


_is_sqlite = settings.DB_URL.startswith("sqlite")
# For SQLite, give writers a busy timeout so concurrent startup writes (many
# accounts connecting at once) wait for the file lock instead of raising
# "database is locked".
_connect_args = {"timeout": 30} if _is_sqlite else {}

engine = create_async_engine(settings.DB_URL, echo=False, future=True, connect_args=_connect_args)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

if _is_sqlite:
    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _record):
        # WAL lets readers and a writer coexist; busy_timeout backs up the
        # connect_args timeout; NORMAL sync is the standard WAL pairing.
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()


async def init_db():
    from . import models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
