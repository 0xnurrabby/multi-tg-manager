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
        if _is_sqlite:
            await _migrate_sqlite(conn)


async def _migrate_sqlite(conn):
    """Lightweight column migrations for existing SQLite databases.

    `create_all` never alters an existing table, so new model columns must be
    added explicitly here. Safe to run on every start (idempotent).
    """
    res = await conn.exec_driver_sql("PRAGMA table_info('security_messages')")
    cols = {row[1] for row in res.all()}
    if "buttons_json" not in cols:
        await conn.exec_driver_sql(
            "ALTER TABLE security_messages ADD COLUMN buttons_json TEXT DEFAULT '[]'"
        )
    if "action_status" not in cols:
        await conn.exec_driver_sql(
            "ALTER TABLE security_messages ADD COLUMN action_status VARCHAR(32) DEFAULT ''"
        )

    res = await conn.exec_driver_sql("PRAGMA table_info('ai_chat_messages')")
    ai_cols = {row[1] for row in res.all()}
    if "reply_to_text" not in ai_cols:
        await conn.exec_driver_sql(
            "ALTER TABLE ai_chat_messages ADD COLUMN reply_to_text TEXT"
        )
    if "reaction" not in ai_cols:
        await conn.exec_driver_sql(
            "ALTER TABLE ai_chat_messages ADD COLUMN reaction VARCHAR(8)"
        )

    res = await conn.exec_driver_sql("PRAGMA table_info('ai_chat_profiles')")
    prof_cols = {row[1] for row in res.all()}
    if "reset_at" not in prof_cols:
        await conn.exec_driver_sql(
            "ALTER TABLE ai_chat_profiles ADD COLUMN reset_at DATETIME"
        )
    if "limit_day" not in prof_cols:
        await conn.exec_driver_sql(
            "ALTER TABLE ai_chat_profiles ADD COLUMN limit_day VARCHAR(10)"
        )


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
