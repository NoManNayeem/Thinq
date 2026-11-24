"""Feedback inbox: flags on answers and documents, for the people who can fix them."""

import uuid

from fastapi import APIRouter, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.strategy_options import _AbstractLoad

from app.api.deps import DbDep, Principal, PrincipalDep, client_ip
from app.api.routes.documents import doc_ref
from app.models import Document, FeedbackItem, MessageSource
from app.schemas.common import error_responses
from app.schemas.feedback import (
    FeedbackItemOut,
    InboxOut,
    ReportDocumentIn,
    ResolveIn,
)
from app.services import feedback
from app.services.documents import trust
from app.services.documents.access import get_visible_document, visible_documents

router = APIRouter(tags=["feedback"])
ERRORS = error_responses(401, 404)


async def _out(
    db: AsyncSession, principal: Principal, items: list[FeedbackItem], *, as_reporter: bool
) -> list[FeedbackItemOut]:
    visible = await _visible_ids(db, principal)
    cited = await _cited_documents(db, [i.message_id for i in items if i.message_id])
    out = []
    for i in items:
        doc = await db.get(Document, i.document_id) if i.document_id in visible else None
        # The answer was built from every source it cited: show it only to someone who can
        # see all of them now. Otherwise the excerpt could carry text from a hidden document.
        sources = cited.get(i.message_id, []) if i.message_id else []
        excerpt_ok = all(d is not None and d in visible for d in sources)
        out.append(
            FeedbackItemOut(
                id=i.id,
                kind=i.kind,
                state=i.state,
                reason=i.reason,
                comment=i.comment,
                question=i.question,
                answer_excerpt=i.answer_excerpt if excerpt_ok else None,
                document=doc_ref(doc) if doc else None,
                # Titles only for documents the viewer can see now.
                document_title=doc.title if doc else None,
                reporter_name="You" if i.reporter_id == principal.user.id else i.reporter.name,
                assigned_to=i.assignee.name if i.assignee else "Admins",
                created_at=i.created_at,
                resolution=i.resolution,
                resolution_note=i.resolution_note,
                resolved_by_name=i.resolved_by.name if i.resolved_by else None,
                resolved_at=i.resolved_at,
                can_resolve=i.state == "open"
                and (feedback.can_resolve(principal, i) or principal.user.is_admin),
            )
        )
    return out


async def _visible_ids(db: AsyncSession, principal: Principal) -> set[uuid.UUID]:
    return set(
        (await db.scalars(visible_documents(principal).with_only_columns(Document.id))).all()
    )


async def _cited_documents(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID | None]]:
    if not message_ids:
        return {}
    rows = await db.execute(
        select(MessageSource.message_id, MessageSource.document_id).where(
            MessageSource.message_id.in_(message_ids)
        )
    )
    out: dict[uuid.UUID, list[uuid.UUID | None]] = {}
    for message_id, document_id in rows:
        out.setdefault(message_id, []).append(document_id)
    return out


def _with_people() -> tuple[_AbstractLoad, ...]:
    return (
        selectinload(FeedbackItem.reporter),
        selectinload(FeedbackItem.assignee),
        selectinload(FeedbackItem.resolved_by),
    )


@router.get("/feedback/inbox", response_model=InboxOut, responses=ERRORS)
async def inbox(principal: PrincipalDep, db: DbDep, state: str = "open") -> InboxOut:
    clause = feedback.inbox_clause(principal)
    stmt = select(FeedbackItem).where(clause).options(*_with_people())
    if state in {"open", "resolved"}:
        stmt = stmt.where(FeedbackItem.state == state)
    else:
        stmt = stmt.where(FeedbackItem.state != "withdrawn")
    visible = await _visible_ids(db, principal)

    def reachable(item: FeedbackItem) -> bool:
        # Items routed to Admins only reach Admins who can see the document concerned.
        return (
            item.assignee_id is not None or item.document_id is None or item.document_id in visible
        )

    rows = [
        i
        for i in (await db.scalars(stmt.order_by(FeedbackItem.created_at.desc()).limit(500))).all()
        if reachable(i)
    ][:200]
    open_items = (
        await db.scalars(select(FeedbackItem).where(clause, FeedbackItem.state == "open"))
    ).all()
    open_count = sum(1 for i in open_items if reachable(i))
    return InboxOut(items=await _out(db, principal, rows, as_reporter=False), open_count=open_count)


@router.get("/feedback/mine", response_model=list[FeedbackItemOut], responses=ERRORS)
async def my_reports(principal: PrincipalDep, db: DbDep) -> list[FeedbackItemOut]:
    rows = list(
        (
            await db.scalars(
                select(FeedbackItem)
                .where(
                    FeedbackItem.reporter_id == principal.user.id, FeedbackItem.state != "withdrawn"
                )
                .options(*_with_people())
                .order_by(FeedbackItem.created_at.desc())
                .limit(200)
            )
        ).all()
    )
    return await _out(db, principal, rows, as_reporter=True)


@router.post(
    "/feedback/items/{item_id}/resolve",
    response_model=FeedbackItemOut,
    responses={**ERRORS, 400: error_responses(400)[400]},
)
async def resolve(
    item_id: uuid.UUID, body: ResolveIn, principal: PrincipalDep, db: DbDep, request: Request
) -> FeedbackItemOut:
    item = await feedback.resolve(
        db,
        principal=principal,
        item_id=item_id,
        resolution="marked_outdated" if body.mark_document_outdated else body.resolution,
        note=body.note,
        ip_address=client_ip(request),
    )
    if body.mark_document_outdated and item.document_id:
        doc = await get_visible_document(db, principal, item.document_id)
        if doc.status != "outdated":
            await trust.change_status(
                db,
                principal=principal,
                doc=doc,
                action="mark_outdated",
                note=body.note or "Reported as outdated.",
                ip_address=client_ip(request),
            )
    await db.commit()
    if body.mark_document_outdated and request.app.state.knowledge is not None:
        request.app.state.knowledge.nudge()
    fresh = await db.scalar(
        select(FeedbackItem).where(FeedbackItem.id == item_id).options(*_with_people())
    )
    assert fresh is not None
    return (await _out(db, principal, [fresh], as_reporter=False))[0]


@router.post(
    "/documents/{document_id}/report",
    response_model=FeedbackItemOut,
    status_code=status.HTTP_201_CREATED,
    responses=ERRORS,
)
async def report_document(
    document_id: uuid.UUID, body: ReportDocumentIn, principal: PrincipalDep, db: DbDep
) -> FeedbackItemOut:
    doc = await get_visible_document(db, principal, document_id)
    item = await feedback.report_document(
        db,
        reporter=principal.user,
        doc=doc,
        reason=body.reason,
        comment=(body.comment or "").strip() or None,
    )
    await db.commit()
    fresh = await db.scalar(
        select(FeedbackItem).where(FeedbackItem.id == item.id).options(*_with_people())
    )
    assert fresh is not None
    return (await _out(db, principal, [fresh], as_reporter=True))[0]
