import json
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Boolean, Text, ForeignKey, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    phone: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    tg_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    first_name: Mapped[str] = mapped_column(String(64), default="")
    last_name: Mapped[str] = mapped_column(String(64), default="")
    username: Mapped[str] = mapped_column(String(64), default="")
    bio: Mapped[str] = mapped_column(String(140), default="")
    session_file: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="disconnected")  # connected/disconnected/banned
    has_2fa: Mapped[bool] = mapped_column(Boolean, default=False)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    messages: Mapped[list["SecurityMessage"]] = relationship(back_populates="account", cascade="all,delete-orphan")


class SecurityMessage(Base):
    __tablename__ = "security_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    tg_msg_id: Mapped[int] = mapped_column(Integer)
    message_text: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(32), default="unknown")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Inline buttons attached to this service message (login approval prompts
    # have Confirm/Decline callback buttons). Stored as a JSON list.
    buttons_json: Mapped[str] = mapped_column(Text, default="[]")
    action_status: Mapped[str] = mapped_column(String(32), default="")

    account: Mapped["Account"] = relationship(back_populates="messages")

    @property
    def buttons(self) -> list[dict]:
        try:
            data = json.loads(self.buttons_json or "[]")
            return data if isinstance(data, list) else []
        except Exception:
            return []


class GoneAccount(Base):
    """Tombstone for an account that left the active list — either banned by
    Telegram or manually removed. `account_id` is a plain int (NOT a FK) so the
    record survives the hard delete of the Account row. `old_serial` is the
    1-based position the account held among active (non-banned) accounts at the
    moment it left."""
    __tablename__ = "gone_accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tg_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    phone: Mapped[str] = mapped_column(String(32), index=True)
    first_name: Mapped[str] = mapped_column(String(64), default="")
    last_name: Mapped[str] = mapped_column(String(64), default="")
    username: Mapped[str] = mapped_column(String(64), default="")
    old_serial: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str] = mapped_column(String(16), default="removed")  # banned/removed
    gone_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class AiChatMessage(Base):
    """One line of an AI-driven conversation with the target Telegram bot.

    direction: "bot" for messages received from the bot, "me" for messages sent
    by the account. tg_msg_id is Telegram's message id (kept so a restart does
    not duplicate the same line when history is re-seeded).
    """
    __tablename__ = "ai_chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    direction: Mapped[str] = mapped_column(String(8))
    text: Mapped[str] = mapped_column(Text)
    tg_msg_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reply_to_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    reaction: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AiChatProfile(Base):
    """Stable persona and long-lived context for one account's AI chat."""
    __tablename__ = "ai_chat_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), unique=True, index=True)
    persona: Mapped[str] = mapped_column(String(32))
    style: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(16), default="English")
    topic: Mapped[str] = mapped_column(String(64), default="")
    # Messages before this moment are ignored for this account. Used when the
    # bot's character changes (for example, the new Meow cat persona) so old
    # service-style conversations do not leak into the fresh chat.
    reset_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Bangladesh calendar day when the bot stopped replying. Fill 100 skips
    # this account until the next daily reset.
    limit_day: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PendingLogin(Base):
    """Temporary phone_code_hash storage between send_code and sign_in."""
    __tablename__ = "pending_logins"
    phone: Mapped[str] = mapped_column(String(32), primary_key=True)
    phone_code_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
