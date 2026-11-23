"""Keep each document's open flags in line with the current checks."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Document, DocumentFlag, Group
from app.services.documents.checks import DocFacts, check_document, duplicate_findings


def facts_for(doc: Document) -> DocFacts:
    group = doc.access_group
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
    )


async def reconcile_flags(db: AsyncSession) -> None:
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
    facts = [facts_for(d) for d in docs]
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
