from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    TG_API_ID: int = 0
    TG_API_HASH: str = ""
    SESSIONS_DIR: str = "./sessions"
    DB_URL: str = "sqlite+aiosqlite:///./app.db"
    RATE_MIN: float = 2.0
    RATE_MAX: float = 4.0
    ALLOWED_ORIGIN: str = "http://localhost:5173"

    APP_PASSWORD: str = ""
    SESSION_SECRET: str = ""
    SESSION_DAYS: int = 14
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_WINDOW_MIN: int = 15

    @property
    def sessions_path(self) -> Path:
        p = Path(self.SESSIONS_DIR)
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
