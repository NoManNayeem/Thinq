"""Import documents from a folder plus a hand-kept manifest.

Layout: ``<root>/manifest.csv`` (optional) and ``<root>/documents/*.md``.

- New files are created. Files in the manifest are registered with its metadata; files
  that aren't are imported as *unregistered* (no access group, so Admins only).
- Content changes create a new version. Unchanged files are left alone, so a scan can run
  on every start-up.
- After the first import Thinq is the system of record: later manifest changes are
  recorded as drift (and flagged) rather than overwriting what Admins have set.
"""

import csv
import hashlib
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Document, DocumentScan, DocumentStatus, DocumentVersion, Group, User
from app.services import audit
from app.services.documents.flags import reconcile_flags
from app.services.groups import slugify

log = structlog.get_logger(__name__)

SCAN_LOCK_KEY = 0x74686E6464  # any constant shared by all instances
SUFFIXES = {".md", ".markdown", ".txt"}
MANIFEST_FIELDS = ("title", "owner", "status", "access_group", "last_modified", "last_reviewed")


@dataclass(frozen=True)
class ManifestRow:
    doc_id: str | None
    file_name: str
    title: str | None
    owner: str | None
    status: str
    last_modified: date | None
    last_reviewed: date | None
    access_group: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "title": self.title,
            "owner": self.owner,
            "status": self.status,
            "access_group": self.access_group,
            "last_modified": self.last_modified.isoformat() if self.last_modified else None,
            "last_reviewed": self.last_reviewed.isoformat() if self.last_reviewed else None,
        }


@dataclass
class ScanReport:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    unchanged: int = 0
    missing: list[str] = field(default_factory=list)
    manifest_without_file: list[str] = field(default_factory=list)
    skipped_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "created": self.created,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "missing": self.missing,
            "manifest_without_file": self.manifest_without_file,
            "skipped_reason": self.skipped_reason,
        }


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value.strip()) if value and value.strip() else None
    except ValueError:
        return None


def parse_status(value: str | None) -> str:
    value = (value or "").strip().lower()
    return value if value in {s.value for s in DocumentStatus} and value != "unknown" else "unknown"


def read_manifest(path: Path) -> dict[str, ManifestRow]:
    if not path.is_file():
        return {}
    rows: dict[str, ManifestRow] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for raw in csv.DictReader(fh):
            row = {k.strip(): v for k, v in raw.items() if k}
            name = _clean(row.get("file_name"))
            if not name:
                continue
            rows[name] = ManifestRow(
                doc_id=_clean(row.get("doc_id")),
                file_name=name,
                title=_clean(row.get("title")),
                owner=_clean(row.get("owner")),
                status=parse_status(row.get("status")),
                last_modified=_date(row.get("last_modified")),
                last_reviewed=_date(row.get("last_reviewed")),
                access_group=_clean(row.get("access_group")),
            )
    return rows


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def _title_from(content: str, path: Path) -> str:
    for line in content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()[:300]
    return path.stem.replace("_", " ")[:300]


def _file_date(path: Path) -> date:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).date()


class _Lookups:
    def __init__(self, groups: list[Group], users: list[User]) -> None:
        self.groups_by_slug = {g.slug: g for g in groups}
        self.users_by_name = {u.name.strip().lower(): u for u in users}

    def group(self, name: str | None) -> Group | None:
        return self.groups_by_slug.get(slugify(name)) if name else None

    def user(self, name: str | None) -> User | None:
        return self.users_by_name.get(name.strip().lower()) if name else None


def _apply_manifest(doc: Document, row: ManifestRow, lookups: _Lookups) -> None:
    group = lookups.group(row.access_group)
    owner = lookups.user(row.owner)
    doc.external_id = row.doc_id
    doc.title = row.title or doc.title
    doc.owner_name = row.owner
    doc.owner_user_id = owner.id if owner else None
    doc.status = row.status
    doc.access_group_id = group.id if group else None
    doc.last_modified = row.last_modified or doc.last_modified
    doc.last_reviewed = row.last_reviewed
    doc.is_registered = True


def _thinq_value(doc: Document, key: str, lookups: _Lookups) -> Any:
    if key == "title":
        return doc.title
    if key == "owner":
        return doc.owner_name
    if key == "status":
        return doc.status
    if key == "access_group":
        group = next(
            (g for g in lookups.groups_by_slug.values() if g.id == doc.access_group_id), None
        )
        return group.name if group else None
    if key == "last_reviewed":
        return doc.last_reviewed.isoformat() if doc.last_reviewed else None
    return None


def _update_drift(doc: Document, row: ManifestRow, lookups: _Lookups) -> None:
    """Record manifest changes that Thinq didn't take, so an Admin can review them."""
    previous: dict[str, Any] = (doc.manifest or {}).get("row") or {}
    drift: dict[str, Any] = dict((doc.manifest or {}).get("drift") or {})
    current = row.as_dict()
    for key in ("title", "owner", "status", "access_group", "last_reviewed"):
        manifest_value = current.get(key)
        thinq_value = _thinq_value(doc, key, lookups)
        if previous and previous.get(key) != manifest_value and manifest_value != thinq_value:
            drift[key] = {"manifest": manifest_value, "thinq": thinq_value}
        elif key in drift and drift[key].get("manifest") == thinq_value:
            drift.pop(key)
    doc.manifest = {"row": current, "drift": drift}


async def scan_documents(db: AsyncSession, root: Path | None, *, actor: User | None) -> ScanReport:
    """Import or refresh every document under ``root``. Safe to run repeatedly and concurrently."""
    report = ScanReport()
    docs_dir = root / "documents" if root else None
    if docs_dir is None or not docs_dir.is_dir():
        report.skipped_reason = "no documents folder"
        return report

    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SCAN_LOCK_KEY})
    scan = DocumentScan(actor_id=actor.id if actor else None)
    db.add(scan)

    manifest = read_manifest(root / "manifest.csv") if root else {}
    lookups = _Lookups(
        list((await db.scalars(select(Group))).all()), list((await db.scalars(select(User))).all())
    )
    existing = {d.source_path: d for d in (await db.scalars(select(Document))).all()}
    seen: set[str] = set()

    for path in sorted(
        p for p in docs_dir.iterdir() if p.is_file() and p.suffix.lower() in SUFFIXES
    ):
        content = path.read_text(encoding="utf-8", errors="replace")
        digest = _hash(content)
        row = manifest.get(path.name)
        seen.add(path.name)
        doc = existing.get(path.name)

        if doc is None:
            doc = Document(
                source_path=path.name,
                title=_title_from(content, path),
                content=content,
                content_hash=digest,
                current_version=1,
                last_modified=_file_date(path),
                status=DocumentStatus.UNKNOWN.value,
                is_registered=False,
                source_present=True,
                manifest={},
            )
            if row:
                _apply_manifest(doc, row, lookups)
                doc.manifest = {"row": row.as_dict(), "drift": {}}
            db.add(doc)
            await db.flush()
            db.add(
                DocumentVersion(document_id=doc.id, version=1, content=content, content_hash=digest)
            )
            report.created.append(path.name)
            continue

        changed = False
        if not doc.source_present:
            doc.source_present = True
            changed = True
        if digest != doc.content_hash:
            doc.current_version += 1
            doc.content = content
            doc.content_hash = digest
            doc.last_modified = _file_date(path)
            db.add(
                DocumentVersion(
                    document_id=doc.id,
                    version=doc.current_version,
                    content=content,
                    content_hash=digest,
                )
            )
            report.updated.append(path.name)
            changed = True
        if row and not doc.is_registered:
            _apply_manifest(doc, row, lookups)
            doc.manifest = {"row": row.as_dict(), "drift": {}}
            changed = True
        elif row:
            _update_drift(doc, row, lookups)
        if not changed:
            report.unchanged += 1

    for source_path, doc in existing.items():
        if source_path not in seen and doc.source_present:
            doc.source_present = False
            report.missing.append(source_path)
    report.manifest_without_file = sorted(set(manifest) - seen - set(existing))

    await db.flush()
    await reconcile_flags(db)
    scan.finished_at = datetime.now(UTC)
    scan.stats = report.as_dict()
    if report.created or report.updated or report.missing or actor is not None:
        await audit.record(
            db,
            actor=actor,
            action="documents.scanned",
            details={
                "created": len(report.created),
                "updated": len(report.updated),
                "missing": len(report.missing),
            },
        )
    await db.flush()
    log.info(
        "documents scanned",
        **{k: len(v) if isinstance(v, list) else v for k, v in report.as_dict().items()},
    )
    return report


async def document_count(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count()).select_from(Document)) or 0)


async def load_with_flags(db: AsyncSession) -> list[Document]:
    return list(
        (
            await db.scalars(
                select(Document).options(
                    selectinload(Document.flags), selectinload(Document.access_group)
                )
            )
        ).all()
    )
