"""Run before the API starts: wait for Postgres, apply migrations, seed. Safe to run concurrently.

Usage: ``python -m app.prestart``
"""

import asyncio
import time
from pathlib import Path

import psycopg
import structlog
from alembic import command
from alembic.config import Config

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.session import create_engine, create_sessionmaker
from app.services.documents.importer import scan_documents
from app.services.seed import seed_from_dir

log = structlog.get_logger("prestart")

# Any constant works; it only has to be the same for every instance of this app.
ADVISORY_LOCK_KEY = 0x7468696E71  # "thinq"
BACKEND_ROOT = Path(__file__).resolve().parent.parent


def libpq_url(settings: Settings) -> str:
    return settings.database_url_str.replace("postgresql+psycopg://", "postgresql://", 1)


def wait_for_database(url: str, timeout_s: float = 60) -> None:
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            with psycopg.connect(url, connect_timeout=3) as conn:
                conn.execute("SELECT 1")
            return
        except psycopg.OperationalError as exc:
            if time.monotonic() > deadline:
                raise
            log.info("waiting for database", error=str(exc).splitlines()[0])
            time.sleep(1)


def alembic_config(settings: Settings) -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url_str.replace("%", "%%"))
    return cfg


async def _seed(settings: Settings) -> None:
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as db, db.begin():
            result = await seed_from_dir(db, settings.seed_dir, settings.seed_password)
        if result.skipped_reason:
            log.info("seed skipped", reason=result.skipped_reason)
        # Documents are re-scanned on every start; unchanged files are left alone.
        async with create_sessionmaker(engine)() as db, db.begin():
            report = await scan_documents(db, settings.seed_dir, actor=None)
        if report.skipped_reason:
            log.info("document scan skipped", reason=report.skipped_reason)
    finally:
        await engine.dispose()


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.log_json)
    url = libpq_url(settings)
    wait_for_database(url)
    with psycopg.connect(url, autocommit=True) as lock_conn:
        lock_conn.execute("SELECT pg_advisory_lock(%s)", (ADVISORY_LOCK_KEY,))
        try:
            log.info("applying migrations")
            command.upgrade(alembic_config(settings), "head")
            asyncio.run(_seed(settings))
        finally:
            lock_conn.execute("SELECT pg_advisory_unlock(%s)", (ADVISORY_LOCK_KEY,))
    log.info("prestart complete")


if __name__ == "__main__":
    main()
