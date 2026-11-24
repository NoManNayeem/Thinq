"""Keeping documents current: one entry point for start-up, the schedule and "Sync now".

Sources sit behind a small interface so more can be added later (a cloud drive, for example).
Today there are two: the synced folder (``FolderSource``) and uploads made in Thinq, which are
stored directly as documents and need no sync.
"""

import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.errors import AppError
from app.models import User
from app.services.documents.importer import ScanReport, record_failed_scan, scan_documents

log = structlog.get_logger(__name__)


class SyncFailed(AppError):
    status_code = 502
    code = "sync_failed"


class Source(Protocol):
    name: str

    def describe(self) -> dict[str, object]: ...

    async def sync(self, db: AsyncSession, *, actor: User | None, trigger: str) -> ScanReport: ...


@dataclass
class FolderSource:
    """A folder of Markdown/text files (sub-folders allowed), plus an optional manifest.csv."""

    root: Path | None
    name: str = "folder"

    def describe(self) -> dict[str, object]:
        docs = self.root / "documents" if self.root else None
        return {
            "kind": "folder",
            "path": str(self.root) if self.root else None,
            "available": bool(docs and docs.is_dir()),
            "manifest": bool(self.root and (self.root / "manifest.csv").is_file()),
        }

    async def sync(self, db: AsyncSession, *, actor: User | None, trigger: str) -> ScanReport:
        return await scan_documents(db, self.root, actor=actor, trigger=trigger)


def source_for(settings: Settings) -> FolderSource:
    return FolderSource(settings.seed_dir)


async def run_sync(
    sessionmaker: async_sessionmaker[AsyncSession],
    settings: Settings,
    *,
    actor_id: uuid.UUID | None = None,
    trigger: str = "manual",
) -> ScanReport:
    """Run one sync in its own transaction. On failure nothing is applied, and the failure is
    recorded (in a separate transaction) so Admins can see it."""
    source = source_for(settings)
    try:
        async with sessionmaker() as db, db.begin():
            actor = await db.get(User, actor_id) if actor_id else None
            return await source.sync(db, actor=actor, trigger=trigger)
    except Exception as exc:
        message = f"{exc.__class__.__name__}: {exc}"
        log.error("document sync failed", trigger=trigger, error=message[:300])
        async with sessionmaker() as db, db.begin():
            actor = await db.get(User, actor_id) if actor_id else None
            await record_failed_scan(db, actor=actor, trigger=trigger, error=message)
        raise SyncFailed(
            "The sync failed and nothing was changed. The error is in the sync history."
        ) from exc


async def sync_forever(
    sessionmaker: async_sessionmaker[AsyncSession], settings: Settings, on_change: object = None
) -> None:
    """Background schedule. Concurrent runs (several API processes) are serialised by the
    scan's advisory lock."""
    while True:
        await asyncio.sleep(settings.sync_interval_s)
        try:
            report = await run_sync(sessionmaker, settings, trigger="schedule")
            if callable(on_change) and (report.created or report.updated or report.missing):
                on_change()
        except SyncFailed:
            pass  # already recorded
        except Exception as exc:  # never let the loop die
            log.warning("scheduled sync error", error=str(exc)[:300])
