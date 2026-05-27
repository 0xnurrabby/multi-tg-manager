from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field


class AccountOut(BaseModel):
    id: int
    phone: str
    tg_user_id: Optional[int] = None
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    bio: str = ""
    status: str
    has_2fa: bool
    is_online: bool
    last_seen: Optional[datetime] = None
    unread_security: int = 0

    class Config:
        from_attributes = True


class StatsOut(BaseModel):
    total: int
    connected: int
    banned: int
    with_2fa: int
    unread_security: int


class SendCodeIn(BaseModel):
    phone: str


class SignInIn(BaseModel):
    phone: str
    code: str
    password: Optional[str] = None


class ProfileUpdateIn(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    bio: Optional[str] = None


class UsernameUpdateIn(BaseModel):
    username: str


class UsernameCheckOut(BaseModel):
    available: bool
    reason: str = ""


class BulkProfileIn(BaseModel):
    account_ids: list[int]
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    bio: Optional[str] = None
    append_number: bool = False  # if true: "Name 1", "Name 2"
    start_number: int = 1
    # Per-account overrides: {"<account_id>": {"first_name": "...", "last_name": "...", "bio": "..."}}
    per_account: Optional[dict[str, dict[str, Optional[str]]]] = None


class BulkPhotoIn(BaseModel):
    account_ids: list[int]
    # image is uploaded separately as multipart


class SecurityMessageOut(BaseModel):
    id: int
    account_id: int
    tg_msg_id: int
    message_text: str
    type: str
    is_read: bool
    received_at: datetime

    class Config:
        from_attributes = True


class TgSessionOut(BaseModel):
    hash: int
    device: str
    platform: str
    app_name: str
    ip: str
    country: str
    date_created: Optional[datetime] = None
    is_current: bool = False


class JoinIn(BaseModel):
    target: str  # username or invite link


class BulkJoinIn(BaseModel):
    account_ids: list[int]
    target: str


class GroupOut(BaseModel):
    id: int
    title: str
    username: Optional[str] = None
    type: str  # group/supergroup/channel
    members: Optional[int] = None
    invite_link: Optional[str] = None


class LeaveIn(BaseModel):
    chat_id: int


class BulkLeaveIn(BaseModel):
    account_ids: list[int]
    chat_id: int


class SendMessageIn(BaseModel):
    target: str
    text: str


class BulkMessageIn(BaseModel):
    account_ids: list[int]
    target: str
    text: str


class ReactIn(BaseModel):
    account_ids: list[int]
    post_link: str  # t.me/channel/123
    emoji: str


class ViewPostIn(BaseModel):
    account_ids: list[int]
    post_link: str


class SettingsIn(BaseModel):
    rate_min: float
    rate_max: float
    sessions_dir: str
    auto_reconnect: bool
    notification_sound: bool


class SettingsOut(SettingsIn):
    pass


class BulkProgressEvent(BaseModel):
    type: str  # "progress" | "done"
    current: int = 0
    total: int = 0
    account_name: str = ""
    success: int = 0
    failed: int = 0
    skipped: int = 0
    detail: str = ""
    errors: list[dict] = Field(default_factory=list)
