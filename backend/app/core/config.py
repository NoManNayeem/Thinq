"""Application settings, read from environment variables prefixed with ``THINQ_``."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="THINQ_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_json: bool = False

    database_url: PostgresDsn = Field(
        default=PostgresDsn("postgresql+psycopg://thinq:thinq@localhost:5432/thinq"),
        description="SQLAlchemy URL. Must use the psycopg driver.",
    )
    database_pool_size: int = 10
    database_connect_timeout_s: int = 3

    session_cookie_name: str = "thinq_session"
    session_ttl_hours: int = 12
    cookie_secure: bool = False

    demo_mode: bool = Field(
        default=False,
        description="Enables one-click sign-in as any active user. Never enable in production.",
    )
    seed_dir: Path | None = Field(
        default=None,
        description="Folder containing users.csv. Only used when the database has no users yet.",
    )
    seed_password: str | None = Field(
        default=None,
        description="Initial password given to seeded users. Leave empty for demo-only sign-in.",
    )

    login_max_failures: int = 5
    login_window_s: int = 900

    @property
    def database_url_str(self) -> str:
        return str(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
