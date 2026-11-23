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

    # ---- answers (Pydantic AI) ------------------------------------------------------
    llm_model: str = Field(
        default="",
        description=(
            'Pydantic AI model as "provider:model", e.g. "openai:gpt-5.2", '
            '"anthropic:claude-sonnet-5-5", "google-gla:gemini-3-flash", "groq:llama-4-scout", '
            '"ollama:qwen3:4b-instruct-2507-q4_K_M". Empty = preview mode (no AI model).'
        ),
    )
    llm_fallback_models: str = Field(
        default="", description="Comma-separated models tried in order if the main one fails."
    )
    llm_timeout_s: float = 90
    llm_max_output_tokens: int = 900
    llm_source_chars: int = Field(
        default=6000, description="Most characters of each cited document sent to the model."
    )

    # ---- retrieval ----------------------------------------------------------------------
    retriever: Literal["lexical", "cognee"] = Field(
        default="lexical",
        description='"cognee" adds Cognee semantic search (needs the cognee compose profile).',
    )
    cognee_url: str = "http://cognee:8000"
    cognee_user: str = "default_user@example.com"
    cognee_password: str | None = None
    cognee_timeout_s: float = 20
    cognee_index_timeout_s: float = 900
    cognee_sync_interval_s: float = 30
    cognee_dataset_prefix: str = "thinq"

    @property
    def database_url_str(self) -> str:
        return str(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
