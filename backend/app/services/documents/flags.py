"""Keep each document's open flags in line with the current checks."""

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.models import Document, DocumentFlag, Group
from app.services.documents.checks import DocFacts, check_document, duplicate_findings
from app.services.documents.trust import review_due

REVIEW_PERIOD_DAYS = 180


def facts_for(doc: Document, review_period_days: int = REVIEW_PERIOD_DAYS) -> DocFacts:
    group = doc.access_group
    due = review_due(doc, review_period_days)
    overdue = due is not None and due < date.today()
    manifest_row = (doc.manifest or {}).get("row") or {}
    return DocFacts(
        id=str(doc.id),
        title=doc.title,
        source_path=doc.source_path,
        content=doc.content,
        status=doc.status,
        owner_name=doc.owner_name,
        access_group_slug=group.slug if group else None,
        access_group_name=group.name if group else None,
        is_registered=doc.is_registered,
        source_present=doc.source_present,
        manifest_group_name=manifest_row.get("access_group"),
        manifest_drift=(doc.manifest or {}).get("drift") or {},
        review_overdue_since=due.isoformat() if overdue and due else None,
        last_reviewed=doc.last_reviewed.isoformat() if doc.last_reviewed else None,
    )


async def reconcile_flags(db: AsyncSession, review_period_days: int | None = None) -> None:
    """Open flags for new problems, resolve flags whose problem went away.

    Runs over every document because duplicates are found across documents. A flag an
    Admin dismissed is not reopened while its evidence (fingerprint) is unchanged.
    """
    docs = list(
        (
            await db.scalars(
                select(Document)
                .options(selectinload(Document.flags), selectinload(Document.access_group))
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    group_names = {g.name.lower() for g in (await db.scalars(select(Group))).all()}
    period = review_period_days or get_settings().review_period_days
    facts = [facts_for(d, period) for d in docs]
    duplicates = duplicate_findings(facts)
    now = datetime.now(UTC)

    for doc, fact in zip(docs, facts, strict=True):
        findings = check_document(fact, group_names) + duplicates.get(fact.id, [])
        wanted = {f.fingerprint: f for f in findings}
        open_flags = {f.fingerprint: f for f in doc.flags if f.resolved_at is None}
        dismissed = {f.fingerprint for f in doc.flags if f.resolution == "dismissed"}

        for fingerprint, finding in wanted.items():
            if fingerprint in open_flags or fingerprint in dismissed:
                continue
            doc.flags.append(
                DocumentFlag(
                    kind=finding.kind,
                    severity=finding.severity.value,
                    message=finding.message,
                    details=finding.details,
                    fingerprint=fingerprint,
                )
            )
        for fingerprint, flag in open_flags.items():
            if fingerprint not in wanted:
                flag.resolved_at = now
                flag.resolution = "fixed"
    await db.flush()
