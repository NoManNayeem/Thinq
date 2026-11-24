"""Trust and approval: the approvals queue, status changes, history and proposals."""

import uuid

from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbDep, PrincipalDep, client_ip
from app.api.routes.documents import detail, doc_ref, open_flag_counts, proposals_for, summarize
from app.core.config import get_settings
from app.core.errors import NotFound
from app.models import Document, DocumentStatus, DocumentStatusChange, StatusProposal
from app.schemas.common import error_responses
from app.schemas.documents import (
    ApprovalItem,
    ApprovalsOut,
    DocumentDetail,
    ProposalDecisionIn,
    StatusActionIn,
    StatusChangeOut,
)
from app.services.documents import trust
from app.services.documents.access import get_visible_document, visible_documents

router = APIRouter(tags=["approvals"])
ERRORS = error_responses(401, 403, 404)


def _nudge(request: Request) -> None:
    if request.app.state.knowledge is not None:
        request.app.state.knowledge.nudge()


@router.get("/approvals", response_model=ApprovalsOut, responses=ERRORS)
async def approvals(principal: PrincipalDep, db: DbDep) -> ApprovalsOut:
    """What this person can decide: drafts awaiting approval, documents with no status, approved
    documents overdue for review, and proposals from approved documents."""
    period = get_settings().review_period_days
    docs = [
        d
        for d in (
            await db.scalars(
                visible_documents(principal)
                .where(Document.is_registered.is_(True), Document.source_present.is_(True))
                .options(selectinload(Document.access_group))
                .order_by(Document.title)
            )
        ).all()
        if trust.can_change_status(principal, d)
    ]
    rejected = await trust.rejected_since_last_version(
        db, [d.id for d in docs if d.status == DocumentStatus.DRAFT.value]
    )
    counts = await open_flag_counts(db, [d.id for d in docs]) if principal.user.is_admin else {}
    items: list[ApprovalItem] = []
    for d in docs:
        reason = None
        if d.status == DocumentStatus.DRAFT.value and d.id not in rejected:
            reason = "awaiting_approval"
        elif d.status == DocumentStatus.UNKNOWN.value:
            reason = "status_unknown"
        elif trust.is_review_overdue(d, period):
            reason = "review_overdue"
        if reason:
            items.append(
                ApprovalItem(
                    **summarize(
                        d, open_flags=counts.get(d.id, 0) if principal.user.is_admin else None
                    ).model_dump(),
                    reason=reason,
                    review_due=trust.review_due(d, period),
                )
            )
    visible_ids = {d.id for d in (await db.scalars(visible_documents(principal))).all()}
    return ApprovalsOut(documents=items, proposals=await proposals_for(db, principal, visible_ids))


@router.post(
    "/documents/{document_id}/status",
    response_model=DocumentDetail,
    responses={**ERRORS, 400: error_responses(400)[400]},
)
async def change_status(
    document_id: uuid.UUID,
    body: StatusActionIn,
    principal: PrincipalDep,
    db: DbDep,
    request: Request,
) -> DocumentDetail:
    doc = await get_visible_document(db, principal, document_id)
    await trust.change_status(
        db,
        principal=principal,
        doc=doc,
        action=body.action,
        note=body.note,
        ip_address=client_ip(request),
    )
    await db.commit()
    _nudge(request)
    doc = await get_visible_document(db, principal, document_id)
    await db.refresh(doc, ["access_group"])
    return await detail(db, principal, doc)


@router.get(
    "/documents/{document_id}/history", response_model=list[StatusChangeOut], responses=ERRORS
)
async def status_history(
    document_id: uuid.UUID, principal: PrincipalDep, db: DbDep
) -> list[StatusChangeOut]:
    doc = await get_visible_document(db, principal, document_id)
    visible_ids = {d.id for d in (await db.scalars(visible_documents(principal))).all()}
    rows = (
        await db.scalars(
            select(DocumentStatusChange)
            .where(DocumentStatusChange.document_id == doc.id)
            .options(selectinload(DocumentStatusChange.actor))
            .order_by(DocumentStatusChange.created_at.desc(), DocumentStatusChange.id.desc())
        )
    ).all()
    out = []
    for r in rows:
        evidence = (
            await db.get(Document, r.evidence_document_id)
            if r.evidence_document_id and r.evidence_document_id in visible_ids
            else None
        )
        out.append(
            StatusChangeOut(
                id=r.id,
                action=r.action,
                from_status=r.from_status,
                to_status=r.to_status,
                actor_name=r.actor.name if r.actor else None,
                note=r.note,
                evidence=doc_ref(evidence) if evidence else None,
                created_at=r.created_at,
            )
        )
    return out


@router.post(
    "/approvals/proposals/{proposal_id}",
    response_model=ApprovalsOut,
    responses={**ERRORS, 400: error_responses(400)[400]},
)
async def decide_proposal(
    proposal_id: int,
    body: ProposalDecisionIn,
    principal: PrincipalDep,
    db: DbDep,
    request: Request,
) -> ApprovalsOut:
    proposal = await db.get(StatusProposal, proposal_id)
    visible_ids = {d.id for d in (await db.scalars(visible_documents(principal))).all()}
    if (
        proposal is None
        or proposal.document_id not in visible_ids
        or proposal.evidence_document_id not in visible_ids
    ):
        raise NotFound("Proposal not found.")
    await trust.decide_proposal(
        db,
        principal=principal,
        proposal=proposal,
        accept=body.accept,
        note=body.note,
        ip_address=client_ip(request),
    )
    await db.commit()
    _nudge(request)
    return await approvals(principal, db)
