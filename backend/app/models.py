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

    account: Mapped["Account"] = relationship(back_populates="messages")


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class PendingLogin(Base):
    """Temporary phone_code_hash storage between send_code and sign_in."""
    __tablename__ = "pending_logins"
    phone: Mapped[str] = mapped_column(String(32), primary_key=True)
    phone_code_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
