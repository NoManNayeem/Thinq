"""Trust and approval: which document is the official one, who may say so, and why.

Rules
- Versions of the same document form a *family* (derived from the title, e.g. "Client Onboarding
  Checklist", "... v3", "... v4"; an Admin can override it). A family never crosses access
  groups.
- The *current* member of a family is its Approved member. Newer never means current.
- Only a document's owner (when they have an account) or an Admin may change its status.
  Every change is recorded in ``document_status_changes``.
- Approving a document retires the family's previously Approved member in the same step
  (Outdated, "superseded by" the new one).
- An Approved document can be *evidence*: when it names another document as the one to use, or as
  retired, Thinq records a proposal. A person always confirms it; nothing is applied automatically.
- An Approved document whose last review is older than the review period is "review overdue".
"""

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import Principal
from app.core.errors import AppError, Forbidden
from app.models import (
    Document,
    DocumentStatus,
    DocumentStatusChange,
    DocumentVersion,
    StatusProposal,
    User,
)
from app.services import audit

VERSION_WORDS = re.compile(
    r"\b(v\d+|final|draft|copy|\d{4}(-\d{2}(-\d{2})?)?|"
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|\d{1,2})\b"
)

Action = str  # approve | mark_outdated | mark_reference | mark_draft | reject | review
ACTIONS: dict[str, str | None] = {
    "approve": DocumentStatus.APPROVED.value,
    "mark_outdated": DocumentStatus.OUTDATED.value,
    "mark_reference": DocumentStatus.REFERENCE.value,
    "mark_draft": DocumentStatus.DRAFT.value,
    "reject": None,  # a draft stays a draft; the rejection and its reason are recorded
    "review": None,  # confirms an Approved document is still correct
}


def family_key(title: str) -> str:
    words = VERSION_WORDS.sub(" ", title.lower().replace(":", " "))
    return " ".join(re.findall(r"[a-z]+", words))


def can_change_status(principal: Principal, doc: Document) -> bool:
    if principal.user.is_admin:
        return True
    return doc.owner_user_id is not None and doc.owner_user_id == principal.user.id


def review_due(doc: Document, period_days: int) -> date | None:
    """When an Approved document's next review is due (None if not approved)."""
    if doc.status != DocumentStatus.APPROVED.value:
        return None
    base = doc.last_reviewed or doc.last_modified
    return base + timedelta(days=period_days) if base else date.today()


def is_review_overdue(doc: Document, period_days: int, today: date | None = None) -> bool:
    due = review_due(doc, period_days)
    return due is not None and due < (today or date.today())


async def ensure_families(db: AsyncSession) -> None:
    docs = (await db.scalars(select(Document).where(Document.family.is_(None)))).all()
    for doc in docs:
        doc.family = family_key(doc.title) or None
    await db.flush()


async def family_members(db: AsyncSession, doc: Document) -> list[Document]:
    if not doc.family:
        return [doc]
    # A family never crosses access groups: approving one group's document must not retire
    # another group's, or reveal its title.
    same_group = (
        Document.access_group_id == doc.access_group_id
        if doc.access_group_id is not None
        else Document.access_group_id.is_(None)
    )
    rows = await db.scalars(
        select(Document)
        .where(Document.family == doc.family, Document.is_registered.is_(True), same_group)
        .order_by(Document.last_modified.desc().nulls_last(), Document.title)
    )
    members = list(rows.all())
    return members if doc in members else [doc, *members]


def current_of(members: list[Document]) -> Document | None:
    approved = [d for d in members if d.status == DocumentStatus.APPROVED.value]
    approved.sort(key=lambda d: (d.last_reviewed or date.min, d.last_modified or date.min))
    return approved[-1] if approved else None


async def _record(
    db: AsyncSession,
    *,
    doc: Document,
    action: str,
    from_status: str,
    actor: User | None,
    note: str | None,
    evidence: Document | None = None,
) -> None:
    db.add(
        DocumentStatusChange(
            document_id=doc.id,
            action=action,
            from_status=from_status,
            to_status=doc.status,
            actor_id=actor.id if actor else None,
            note=note,
            evidence_document_id=evidence.id if evidence else None,
        )
    )


async def change_status(
    db: AsyncSession,
    *,
    principal: Principal,
    doc: Document,
    action: str,
    note: str | None = None,
    evidence: Document | None = None,
    ip_address: str | None = None,
) -> list[Document]:
    """Apply an approval action. Returns every document whose status changed."""
    if action not in ACTIONS:
        raise AppError("Unknown action.", code="unknown_action")
    if not can_change_status(principal, doc):
        raise Forbidden("Only the document's owner or an Admin can change its status.")
    if not doc.is_registered:
        raise AppError("Register the document before changing its status.", code="unregistered")
    note = (note or "").strip() or None
    actor = principal.user
    before = doc.status
    target = ACTIONS[action]
    changed: list[Document] = []

    if action == "reject":
        if doc.status != DocumentStatus.DRAFT.value:
            raise AppError("Only a draft can be rejected.", code="not_a_draft")
        if not note:
            raise AppError("Say why, so the owner knows what to change.", code="note_required")
    elif action == "review":
        if doc.status != DocumentStatus.APPROVED.value:
            raise AppError(
                "Only an approved document can be marked as reviewed.", code="not_approved"
            )
        doc.last_reviewed = date.today()
    elif target == before:
        raise AppError("The document already has that status.", code="no_change")
    else:
        doc.status = target  # type: ignore[assignment]
        changed.append(doc)
        if target == DocumentStatus.APPROVED.value:
            doc.last_reviewed = date.today()
            doc.superseded_by_id = None
            # The previous official version is retired in the same step.
            for other in await family_members(db, doc):
                if other.id != doc.id and other.status == DocumentStatus.APPROVED.value:
                    other_before = other.status
                    other.status = DocumentStatus.OUTDATED.value
                    other.superseded_by_id = doc.id
                    await _record(
                        db,
                        doc=other,
                        action="superseded",
                        from_status=other_before,
                        actor=actor,
                        note=f"Replaced by {doc.title}.",
                    )
                    changed.append(other)
        elif target == DocumentStatus.OUTDATED.value:
            current = current_of(await family_members(db, doc))
            doc.superseded_by_id = current.id if current and current.id != doc.id else None

    await _record(
        db, doc=doc, action=action, from_status=before, actor=actor, note=note, evidence=evidence
    )
    await audit.record(
        db,
        actor=actor,
        action="document.status_changed",
        target=doc,
        details={
            "action": action,
            "from": before,
            "to": doc.status,
            "also_changed": [str(d.id) for d in changed if d.id != doc.id],
            **({"note": note} if note else {}),
            **({"evidence": str(evidence.id)} if evidence else {}),
        },
        ip_address=ip_address,
    )
    await db.flush()
    await refresh_proposals(db)
    return changed


# ---------------------------------------------------------------- evidence


_RETIRE = re.compile(
    r"\b(retired|no longer (?:used|accepted|valid|in use)|not (?:be )?(?:accepted|processed)|"
    r"will not process|superseded|replaced|obsolete|do not use|outdated|withdrawn)\b",
    re.IGNORECASE,
)
_CURRENT = re.compile(
    r"\b(must (?:be|use)|use the|is the (?:current|official|only)|current version|"
    r"only (?:accept|use)|effective (?:today|immediately|from)|official)\b",
    re.IGNORECASE,
)


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _names(doc: Document) -> list[set[str]]:
    stem = PurePath(doc.source_path).stem.replace("_", " ")
    names = [_tokens(doc.title), _tokens(stem)]
    return [n for n in names if len(n) >= 3]


def _sentences(content: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", content)
    return [p.strip() for p in parts if len(p.strip()) > 12]


def _audience_covers(source: Document, target: Document) -> bool:
    """A proposal shows the evidence text beside the target, so whoever may decide on the target
    must be able to read the source: same group, or the source is shared with everyone."""
    if source.access_group_id == target.access_group_id:
        return True
    group = source.access_group
    return bool(group is not None and group.is_system)


@dataclass(frozen=True)
class Evidence:
    target: Document
    proposed: str
    sentence: str


def find_evidence(source: Document, candidates: list[Document]) -> list[Evidence]:
    """Statements in an approved document about which other document is current or retired.

    A sentence names a document when it contains every word of the document's title or file name
    (in any order). If several match, the most specific name wins, so "Vendor Onboarding Form
    FINAL v2" isn't also read as "Vendor Onboarding Form".
    """
    found: list[Evidence] = []
    for sentence in _sentences(source.content):
        words = _tokens(sentence)
        best: tuple[int, Document] | None = None
        for doc in candidates:
            if doc.id == source.id or (doc.family and doc.family == source.family):
                continue
            if not _audience_covers(source, doc):
                continue  # evidence only about documents its readers can already see
            size = max((len(n) for n in _names(doc) if n <= words), default=0)
            if size and (best is None or size > best[0]):
                best = (size, doc)
        if best is None:
            continue
        if _RETIRE.search(sentence):
            found.append(Evidence(best[1], DocumentStatus.OUTDATED.value, sentence))
        elif _CURRENT.search(sentence):
            found.append(Evidence(best[1], DocumentStatus.APPROVED.value, sentence))
    return found


async def refresh_proposals(db: AsyncSession) -> None:
    """Record new proposals from approved documents; close ones that no longer apply."""
    docs = list(
        (
            await db.scalars(
                select(Document)
                .where(Document.is_registered.is_(True))
                .options(selectinload(Document.access_group))
            )
        ).all()
    )
    by_id = {d.id: d for d in docs}
    existing = {
        (p.document_id, p.proposed_status, p.evidence_document_id): p
        for p in (await db.scalars(select(StatusProposal))).all()
    }
    now = datetime.now(UTC)
    for source in docs:
        if source.status != DocumentStatus.APPROVED.value:
            continue
        for ev in find_evidence(source, docs):
            if ev.target.status == ev.proposed:
                continue
            key = (ev.target.id, ev.proposed, source.id)
            if key not in existing:
                proposal = StatusProposal(
                    document_id=ev.target.id,
                    proposed_status=ev.proposed,
                    evidence_document_id=source.id,
                    evidence_text=ev.sentence[:600],
                    state="open",
                )
                db.add(proposal)
                existing[key] = proposal
    for (doc_id, proposed, evidence_id), p in existing.items():
        if p.state != "open":
            continue
        target, evidence = by_id.get(doc_id), by_id.get(evidence_id)
        if (
            target is None
            or evidence is None
            or evidence.status != DocumentStatus.APPROVED.value
            or not _audience_covers(evidence, target)
        ):
            p.state, p.decided_at = "superseded", now
        elif target.status == proposed:
            p.state, p.decided_at = "superseded", now  # someone set it another way
    await db.flush()


async def decide_proposal(
    db: AsyncSession,
    *,
    principal: Principal,
    proposal: StatusProposal,
    accept: bool,
    note: str | None,
    ip_address: str | None,
) -> None:
    if proposal.state != "open":
        raise AppError("This proposal has already been decided.", code="proposal_closed")
    target = await db.get(Document, proposal.document_id)
    evidence = await db.get(Document, proposal.evidence_document_id)
    if target is None or evidence is None:
        raise AppError("The documents behind this proposal are gone.", code="proposal_closed")
    if not can_change_status(principal, target):
        raise Forbidden("Only the document's owner or an Admin can decide this.")
    if accept:
        action = {
            DocumentStatus.APPROVED.value: "approve",
            DocumentStatus.OUTDATED.value: "mark_outdated",
        }[proposal.proposed_status]
        await change_status(
            db,
            principal=principal,
            doc=target,
            action=action,
            note=note or f"Confirmed from {evidence.title}: “{proposal.evidence_text}”",
            evidence=evidence,
            ip_address=ip_address,
        )
    proposal.state = "accepted" if accept else "rejected"
    proposal.decided_by_id = principal.user.id
    proposal.decided_at = datetime.now(UTC)
    proposal.note = (note or "").strip() or None
    await db.flush()


async def rejected_since_last_version(db: AsyncSession, doc_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Drafts whose latest decision is a rejection that's newer than their latest content."""
    if not doc_ids:
        return set()
    latest_reject = dict(
        (
            await db.execute(
                select(DocumentStatusChange.document_id, DocumentStatusChange.created_at)
                .where(
                    DocumentStatusChange.document_id.in_(doc_ids),
                    DocumentStatusChange.action == "reject",
                )
                .order_by(DocumentStatusChange.created_at)
            )
        ).all()
    )
    latest_version = dict(
        (
            await db.execute(
                select(DocumentVersion.document_id, DocumentVersion.created_at)
                .where(DocumentVersion.document_id.in_(list(latest_reject)))
                .order_by(DocumentVersion.created_at)
            )
        ).all()
    )
    return {d for d, at in latest_reject.items() if d in latest_version and at > latest_version[d]}
