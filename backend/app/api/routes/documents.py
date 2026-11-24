import uuid
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import DbDep, Principal, PrincipalDep
from app.api.serializers import group_ref
from app.core.config import get_settings
from app.core.errors import NotFound
from app.models import Document, DocumentFlag, DocumentVersion, Role, StatusProposal, User
from app.models.group import EVERYONE_SLUG
from app.schemas.common import error_responses
from app.schemas.documents import (
    DocumentDetail,
    DocumentListOut,
    DocumentRef,
    DocumentSummary,
    FamilyMemberOut,
    FlagOut,
    OwnerOut,
    ProposalOut,
    VersionDetail,
    VersionOut,
)
from app.services.documents import trust
from app.services.documents.access import get_visible_document, visible_documents
from app.services.users import member_count

router = APIRouter(prefix="/documents", tags=["documents"])

SNIPPET_RADIUS = 80


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def snippet(content: str, query: str) -> str | None:
    index = content.lower().find(query.lower())
    if index < 0:
        return None
    start, end = (
        max(0, index - SNIPPET_RADIUS),
        min(len(content), index + len(query) + SNIPPET_RADIUS),
    )
    text = " ".join(content[start:end].split())
    return f"{'…' if start else ''}{text}{'…' if end < len(content) else ''}"


def summarize(
    doc: Document, *, open_flags: int | None, match: str | None = None
) -> DocumentSummary:
    return DocumentSummary(
        id=doc.id,
        title=doc.title,
        source_path=doc.source_path,
        external_id=doc.external_id,
        status=doc.status,
        owner=OwnerOut(
            name=doc.owner_name,
            user_id=doc.owner_user_id,
            has_account=doc.owner_user_id is not None,
        ),
        access_group=group_ref(doc.access_group) if doc.access_group else None,
        last_modified=doc.last_modified,
        last_reviewed=doc.last_reviewed,
        is_registered=doc.is_registered,
        source_present=doc.source_present,
        current_version=doc.current_version,
        updated_at=doc.updated_at,
        open_flag_count=open_flags,
        match=match,
    )


async def open_flag_counts(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = await db.execute(
        select(DocumentFlag.document_id, func.count())
        .where(DocumentFlag.document_id.in_(ids), DocumentFlag.resolved_at.is_(None))
        .group_by(DocumentFlag.document_id)
    )
    return {doc_id: int(n) for doc_id, n in rows}


async def audience(db: AsyncSession, doc: Document) -> int:
    if doc.access_group is None:
        stmt = (
            select(func.count())
            .select_from(User)
            .where(User.is_active.is_(True), User.role == Role.ADMIN.value)
        )
        return int(await db.scalar(stmt) or 0)
    if doc.access_group.slug == EVERYONE_SLUG:
        return int(
            await db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True)))
            or 0
        )
    return await member_count(db, doc.access_group)


async def detail(db: AsyncSession, principal: Principal, doc: Document) -> DocumentDetail:
    is_admin = principal.user.is_admin
    flags = None
    if is_admin:
        flag_rows = (
            await db.scalars(
                select(DocumentFlag)
                .where(DocumentFlag.document_id == doc.id)
                .order_by(DocumentFlag.resolved_at.is_not(None), DocumentFlag.created_at.desc())
            )
        ).all()
        mine = {
            str(i)
            for i in (
                await db.scalars(visible_documents(principal).with_only_columns(Document.id))
            ).all()
        }
        flags = [flag_out(f, mine) for f in flag_rows]
    open_count = sum(1 for f in flags or [] if f.resolved_at is None) if is_admin else None
    period = get_settings().review_period_days
    visible_ids = set(
        (await db.scalars(visible_documents(principal).with_only_columns(Document.id))).all()
    )
    members = [m for m in await trust.family_members(db, doc) if m.id in visible_ids]
    current = trust.current_of(members)
    superseded = (
        await db.get(Document, doc.superseded_by_id)
        if doc.superseded_by_id and doc.superseded_by_id in visible_ids
        else None
    )
    can_change = trust.can_change_status(principal, doc)
    proposals = (
        await proposals_for(db, principal, visible_ids, document_id=doc.id) if can_change else []
    )
    return DocumentDetail(
        **summarize(doc, open_flags=open_count).model_dump(),
        content=doc.content,
        audience_count=await audience(db, doc),
        flags=flags,
        source_kind=doc.source_kind,
        family=[
            FamilyMemberOut(
                id=m.id,
                title=m.title,
                status=m.status,
                last_modified=m.last_modified,
                last_reviewed=m.last_reviewed,
                is_current=current is not None and m.id == current.id,
                is_self=m.id == doc.id,
            )
            for m in members
        ]
        if len(members) > 1
        else [],
        superseded_by=doc_ref(superseded) if superseded else None,
        can_change_status=can_change and doc.is_registered,
        review_due=trust.review_due(doc, period),
        review_overdue=trust.is_review_overdue(doc, period),
        proposals=proposals,
    )


def flag_out(flag: DocumentFlag, visible: set[str]) -> FlagOut:
    """A flag that names another document only names it to someone who can see it."""
    out = FlagOut.model_validate(flag)
    other = (flag.details or {}).get("of_document_id")
    if other is not None and str(other) not in visible:
        out.message = "This looks like a copy of a document you can't see."
        out.details = {"similarity": (flag.details or {}).get("similarity")}
    return out


def doc_ref(doc: Document) -> DocumentRef:
    return DocumentRef(id=doc.id, title=doc.title, status=doc.status)


async def proposals_for(
    db: AsyncSession,
    principal: Principal,
    visible_ids: set[uuid.UUID],
    *,
    document_id: uuid.UUID | None = None,
) -> list[ProposalOut]:
    """Open proposals this person may decide: they can see both documents and may change the
    target's status."""
    stmt = (
        select(StatusProposal)
        .where(StatusProposal.state == "open")
        .options(selectinload(StatusProposal.document), selectinload(StatusProposal.evidence))
        .order_by(StatusProposal.created_at)
    )
    if document_id is not None:
        stmt = stmt.where(StatusProposal.document_id == document_id)
    out = []
    for p in (await db.scalars(stmt)).all():
        if p.document_id not in visible_ids or p.evidence_document_id not in visible_ids:
            continue
        if not trust.can_change_status(principal, p.document):
            continue
        out.append(
            ProposalOut(
                id=p.id,
                document=doc_ref(p.document),
                proposed_status=p.proposed_status,
                evidence=doc_ref(p.evidence),
                evidence_text=p.evidence_text,
                state=p.state,
                created_at=p.created_at,
            )
        )
    return out


@router.get("", response_model=DocumentListOut, responses=error_responses(401))
async def list_documents(
    principal: PrincipalDep,
    db: DbDep,
    q: str | None = Query(default=None, max_length=200),
    status: Literal["approved", "draft", "outdated", "reference", "unknown"] | None = None,
    group_id: uuid.UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> DocumentListOut:
    base = visible_documents(principal)
    query = (q or "").strip()
    if query:
        like = f"%{_escape_like(query)}%"
        base = base.where(
            or_(
                Document.title.ilike(like, escape="\\"),
                Document.content.ilike(like, escape="\\"),
                Document.source_path.ilike(like, escape="\\"),
            )
        )
    if group_id:
        base = base.where(Document.access_group_id == group_id)

    counts = {
        s: int(n)
        for s, n in await db.execute(
            base.with_only_columns(Document.status, func.count()).group_by(Document.status)
        )
    }
    filtered = base.where(Document.status == status) if status else base
    total = int(await db.scalar(select(func.count()).select_from(filtered.subquery())) or 0)
    docs = (
        await db.scalars(
            filtered.options(selectinload(Document.access_group))
            .order_by(Document.is_registered, func.lower(Document.title))
            .limit(limit)
            .offset(offset)
        )
    ).all()
    flag_counts = (
        await open_flag_counts(db, [d.id for d in docs]) if principal.user.is_admin else None
    )
    return DocumentListOut(
        items=[
            summarize(
                d,
                open_flags=None if flag_counts is None else flag_counts.get(d.id, 0),
                match=snippet(d.content, query)
                if query and query.lower() not in d.title.lower()
                else None,
            )
            for d in docs
        ],
        total=total,
        status_counts=counts,
    )


@router.get("/{document_id}", response_model=DocumentDetail, responses=error_responses(401, 404))
async def get_document(
    document_id: uuid.UUID, principal: PrincipalDep, db: DbDep
) -> DocumentDetail:
    doc = await get_visible_document(db, principal, document_id)
    await db.refresh(doc, ["access_group"])
    return await detail(db, principal, doc)


@router.get(
    "/{document_id}/versions", response_model=list[VersionOut], responses=error_responses(401, 404)
)
async def list_versions(
    document_id: uuid.UUID, principal: PrincipalDep, db: DbDep
) -> list[VersionOut]:
    doc = await get_visible_document(db, principal, document_id)
    versions = (
        await db.scalars(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == doc.id)
            .order_by(DocumentVersion.version.desc())
        )
    ).all()
    return [
        VersionOut(
            version=v.version,
            content_hash=v.content_hash,
            created_at=v.created_at,
            is_current=v.version == doc.current_version,
        )
        for v in versions
    ]


@router.get(
    "/{document_id}/versions/{version}",
    response_model=VersionDetail,
    responses=error_responses(401, 404),
)
async def get_version(
    document_id: uuid.UUID, version: int, principal: PrincipalDep, db: DbDep
) -> VersionDetail:
    doc = await get_visible_document(db, principal, document_id)
    row = await db.scalar(
        select(DocumentVersion).where(
            DocumentVersion.document_id == doc.id, DocumentVersion.version == version
        )
    )
    if row is None:
        raise NotFound("Version not found.")
    return VersionDetail(
        version=row.version,
        content_hash=row.content_hash,
        created_at=row.created_at,
        is_current=row.version == doc.current_version,
        content=row.content,
    )
