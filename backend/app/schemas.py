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
    login_email_pattern: str = ""
    login_email_address: str = ""
    recovery_email: str = ""
    email_checked_at: Optional[datetime] = None
    is_online: bool
    last_seen: Optional[datetime] = None
    unread_security: int = 0
    created_at: Optional[datetime] = None
    # Oldest Telegram service message (user 777000) — a proxy for account age.
    tg_since: Optional[datetime] = None

    class Config:
        from_attributes = True


class GoneAccountOut(BaseModel):
    id: int
    account_id: Optional[int] = None
    tg_user_id: Optional[int] = None
    phone: str
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    old_serial: Optional[int] = None
    reason: str
    gone_at: datetime

    class Config:
        from_attributes = True


class StatsOut(BaseModel):
    total: int
    connected: int
    banned: int
    with_2fa: int
    with_email: int = 0
    unread_security: int
    reset_requests: int = 0


class SendCodeIn(BaseModel):
    phone: str


class SignInIn(BaseModel):
    phone: str
    code: str
    password: Optional[str] = None


class RemoveAllAccountsIn(BaseModel):
    password: str


class QrStartOut(BaseModel):
    qr_id: str
    url: str
    expires_at: Optional[str] = None


class QrPollIn(BaseModel):
    qr_id: str


class QrSubmit2faIn(BaseModel):
    qr_id: str
    password: str


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
    username: Optional[str] = None
    bio: Optional[str] = None
    append_number: bool = False  # if true: "Name 1", "Name 2", "username1", "username2"
    start_number: int = 1
    # Per-account overrides: {"<account_id>": {"first_name": "...", "last_name": "...", "username": "...", "bio": "..."}}
    per_account: Optional[dict[str, dict[str, Optional[str]]]] = None


class BulkAiProfileIn(BaseModel):
    account_ids: list[int]


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
    buttons: list[dict] = Field(default_factory=list)
    action_status: Optional[str] = ""

    class Config:
        from_attributes = True


class PressServiceButtonIn(BaseModel):
    index: int


class AutoDeclineIn(BaseModel):
    enabled: bool


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


class BulkLeaveTargetIn(BaseModel):
    """Leave ONE specific group/channel (by @username or invite link) from every
    selected account that is currently a member of it."""
    account_ids: list[int]
    target: str


class BulkLeaveAllIn(BaseModel):
    """Leave EVERY group/channel each account is in."""
    account_ids: list[int]


class BulkDeleteMyMessagesIn(BaseModel):
    """Delete every message each account sent across ALL its groups/channels."""
    account_ids: list[int]
    max_scan: int = 2000


class SendMessageIn(BaseModel):
    target: str
    text: str


class BulkMessageIn(BaseModel):
    account_ids: list[int]
    target: str
    text: str


class BulkWipeChatIn(BaseModel):
    """Delete the ENTIRE conversation with one user/chat (by @username or t.me
    link) from every selected account: clears history for both sides (revoke)
    and removes the dialog so the chat no longer exists."""
    account_ids: list[int]
    target: str


class OpenChatIn(BaseModel):
    # A @username, bare username, t.me link, or tg://resolve deep link. Bot
    # referral links like t.me/Bot?start=PAYLOAD fire the bot /start so the
    # referral registers.
    input: str
    limit: int = 40


class ChatSendIn(BaseModel):
    peer: str   # username or numeric id (as returned by /open)
    text: str


class TargetUsageCheckIn(BaseModel):
    target: str


class ReactionAssignment(BaseModel):
    emoji: str  # the alt/standard glyph (display + standard reactions)
    account_ids: list[int]
    custom_emoji_id: Optional[int] = None  # premium custom emoji document id


class ReactIn(BaseModel):
    post_link: str  # t.me/channel/123
    reactions: list[ReactionAssignment]


class ViewPostIn(BaseModel):
    account_ids: list[int]
    post_link: str


class AllowedReactionsIn(BaseModel):
    post_link: str
    account_id: Optional[int] = None  # which account to query through; else first connected


class AllowedCustomReaction(BaseModel):
    id: int          # custom emoji document id
    alt: str = ""    # fallback glyph to display


class AllowedReactionsOut(BaseModel):
    mode: str  # "all" | "some" | "none"
    allow_custom: bool = False
    standard: list[str] = Field(default_factory=list)
    custom: list[AllowedCustomReaction] = Field(default_factory=list)


class Bulk2faIn(BaseModel):
    account_ids: list[int]
    new_password: str
    hint: Optional[str] = ""
    # Current-password attempt bank (max 5). Tried in order, after each account's
    # own remembered password, until one is accepted (5 tries max per account).
    password_bank: list[str] = Field(default_factory=list)


class EmailLoginSendIn(BaseModel):
    email: str


class EmailLoginVerifyIn(BaseModel):
    email: str
    code: str


class AccountTtlIn(BaseModel):
    days: int
    # Empty/None means every connected account.
    account_ids: Optional[list[int]] = None


class ResetCancelIn(BaseModel):
    # Optional phone code, if Telegram sent it by SMS instead of to the app.
    code: Optional[str] = None


class Bulk2faOffIn(BaseModel):
    account_ids: list[int]
    password_bank: list[str] = Field(default_factory=list)


class LogoutAllIn(BaseModel):
    # Session hash to keep (for example the buyer bot that just logged in).
    keep_hash: Optional[int] = None


class AutoRecoveryIn(BaseModel):
    account_ids: Optional[list[int]] = None
    concurrency: int = 5


class EmailAutoIn(BaseModel):
    account_ids: Optional[list[int]] = None
    concurrency: int = 5
    login: bool = True
    recovery: bool = True


class NurMailIn(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    clear: bool = False


class RecoveryIn(BaseModel):
    # Empty + create_mailbox=false does nothing; empty + true creates one.
    email: Optional[str] = None
    create_mailbox: bool = False
    mailbox_name: Optional[str] = None


class RecoveryConfirmIn(BaseModel):
    code: str


class SettingsIn(BaseModel):
    rate_min: float
    rate_max: float
    concurrency: int = 5
    sessions_dir: str
    auto_reconnect: bool
    notification_sound: bool


class SettingsOut(SettingsIn):
    pass


class AiSettingsIn(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
    target: Optional[str] = None
    min_turns: Optional[int] = None
    max_turns: Optional[int] = None


class AiKeyIn(BaseModel):
    api_key: str
    model: Optional[str] = None


class AiStartIn(BaseModel):
    account_ids: list[int]
    fill_daily: bool = False


class AiStopIn(BaseModel):
    account_ids: Optional[list[int]] = None


class AiDailyCountsIn(BaseModel):
    account_ids: list[int] = Field(default_factory=list)


class AiCustomIn(BaseModel):
    account_ids: list[int] = Field(default_factory=list)
    message: str


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
