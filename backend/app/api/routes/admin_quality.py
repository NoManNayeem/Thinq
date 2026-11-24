"""Admin tools for answer quality: the retrieval inspector and the quality dashboard."""

import re
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminDep, DbDep, Principal, client_ip
from app.core.errors import NotFound
from app.models import (
    ChatMessage,
    Document,
    FeedbackItem,
    MessageFeedback,
    MessageSource,
    User,
)
from app.schemas.common import error_responses
from app.services import audit
from app.services.access import effective_groups
from app.services.chat.engines import common_notices
from app.services.chat.retrieval import retrieve
from app.services.documents.access import visible_documents
from app.services.knowledge.cognee_client import CogneeError
from app.services.knowledge.service import KnowledgeService, SemanticHit

router = APIRouter(prefix="/admin", tags=["admin: quality"])
ERRORS = error_responses(401, 403, 404)


# ---------------------------------------------------------------- inspector


class InspectIn(BaseModel):
    user_id: uuid.UUID
    question: str = Field(min_length=1, max_length=4000)


class InspectCandidate(BaseModel):
    title: str
    status: str
    relevance: float
    lexical: float | None = None
    semantic: float | None = None
    trust_weight: float
    decision: str
    rank: int | None = None


class InspectPassage(BaseModel):
    rank: int
    title: str
    status: str
    excerpt: str
    score: float


class InspectOut(BaseModel):
    as_user: str
    groups: list[str]
    searched: int
    excluded: dict[str, int]
    semantic: str
    candidates: list[InspectCandidate]
    hidden_from_you: int = Field(
        description="Candidates in documents you can't see yourself (shown as a count only)"
    )
    passages: list[InspectPassage]
    notices: list[str]
    owner_hint: dict[str, str] | None


@router.post("/retrieval/inspect", response_model=InspectOut, responses=ERRORS)
async def inspect_retrieval(
    body: InspectIn, admin: AdminDep, db: DbDep, request: Request
) -> InspectOut:
    """Run a question as any user and see what was eligible, what was returned, and why.

    Nothing is answered or stored. The Admin only sees titles of documents they can see
    themselves; anything else is counted, never named.
    """
    user = await db.get(User, body.user_id)
    if user is None:
        raise NotFound("User not found.")
    target = Principal(user=user, session=admin.session, groups=await effective_groups(db, user))
    knowledge: KnowledgeService | None = request.app.state.knowledge
    hits: list[SemanticHit] = []
    semantic = "off"
    if knowledge is not None:
        try:
            hits = await knowledge.search(db, target, body.question)
            semantic = "ok"
        except CogneeError:
            semantic = "unavailable"
    result = await retrieve(db, target, body.question, hits)
    mine = set((await db.scalars(visible_documents(admin).with_only_columns(Document.id))).all())
    shown = [c for c in result.candidates if uuid.UUID(str(c["id"])) in mine]
    await audit.record(
        db,
        actor=admin.user,
        action="retrieval.inspected",
        details={"as_user": str(user.id)},
        ip_address=client_ip(request),
    )
    await db.commit()
    return InspectOut(
        as_user=user.name,
        groups=[g.name for g in target.groups],
        searched=result.searched,
        excluded=result.excluded,
        semantic=semantic,
        candidates=[InspectCandidate(**{k: v for k, v in c.items() if k != "id"}) for c in shown],
        hidden_from_you=len(result.candidates) - len(shown),
        passages=[
            InspectPassage(
                rank=i,
                title=p.document.title,
                status=p.document.status,
                excerpt=p.excerpt,
                score=round(p.score, 4),
            )
            for i, p in enumerate(result.passages, start=1)
            if p.document.id in mine
        ],
        notices=[
            n.message for n in common_notices(result) if all(d in mine for d in n.document_ids)
        ],
        owner_hint=result.owner_hint
        if result.owner_hint and uuid.UUID(result.owner_hint["document_id"]) in mine
        else None,
    )


# ---------------------------------------------------------------- dashboard


class UnansweredOut(BaseModel):
    question: str
    times: int


class QualityOut(BaseModel):
    days: int
    questions: int
    answered: int = Field(description="Answers that cited at least one source")
    no_source: int = Field(description='"I couldn\'t find it" answers')
    errors: int
    stopped: int
    helpful: int
    not_helpful: int
    open_reports: int
    resolved_reports: int
    median_hours_to_resolve: float | None
    input_tokens: int
    output_tokens: int
    cost_usd: float | None
    by_day: list[dict[str, Any]]
    top_unanswered: list[UnansweredOut]
    top_cited: list[dict[str, Any]]


def _normalise(question: str) -> str:
    return re.sub(r"\s+", " ", question.strip().lower()).rstrip("?.! ")[:200]


@router.get("/quality", response_model=QualityOut, responses=ERRORS)
async def quality(
    admin: AdminDep, db: DbDep, days: int = Query(default=30, ge=1, le=365)
) -> QualityOut:
    """Live figures from answers and feedback. Unanswered questions are shown without who
    asked them, so owners can see what's missing from the documentation."""
    since = datetime.now(UTC) - timedelta(days=days)
    answers = list(
        (
            await db.scalars(
                select(ChatMessage)
                .where(ChatMessage.role == "assistant", ChatMessage.created_at >= since)
                .options(selectinload(ChatMessage.sources))
            )
        ).all()
    )
    answered = [a for a in answers if a.sources and a.status == "complete"]
    no_source = [a for a in answers if not a.sources and a.status == "complete"]

    # The question before each unanswered answer (same conversation, latest user turn).
    unanswered: Counter[str] = Counter()
    for a in no_source:
        q = await db.scalar(
            select(ChatMessage.content)
            .where(
                ChatMessage.conversation_id == a.conversation_id,
                ChatMessage.role == "user",
                ChatMessage.created_at <= a.created_at,
            )
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        if q:
            unanswered[_normalise(q)] += 1

    ratings = dict(
        (
            await db.execute(
                select(MessageFeedback.rating, func.count())
                .join(ChatMessage, ChatMessage.id == MessageFeedback.message_id)
                .where(ChatMessage.created_at >= since)
                .group_by(MessageFeedback.rating)
            )
        ).all()
    )
    reports = list(
        (await db.scalars(select(FeedbackItem).where(FeedbackItem.created_at >= since))).all()
    )
    hours = sorted(
        (r.resolved_at - r.created_at).total_seconds() / 3600
        for r in reports
        if r.state == "resolved" and r.resolved_at
    )
    by_day: dict[str, dict[str, int]] = {}
    for a in answers:
        day = a.created_at.date().isoformat()
        row = by_day.setdefault(day, {"questions": 0, "no_source": 0})
        row["questions"] += 1
        if a in no_source:
            row["no_source"] += 1
    mine = set((await db.scalars(visible_documents(admin).with_only_columns(Document.id))).all())
    cited = Counter(
        s.title
        for a in answered
        for s in a.sources
        if isinstance(s, MessageSource) and s.rank == 1 and s.document_id in mine
    )
    costs = [a.cost_usd for a in answers if a.cost_usd is not None]
    return QualityOut(
        days=days,
        questions=len(answers),
        answered=len(answered),
        no_source=len(no_source),
        errors=sum(1 for a in answers if a.status == "error"),
        stopped=sum(1 for a in answers if a.status == "stopped"),
        helpful=int(ratings.get("up", 0)),
        not_helpful=int(ratings.get("down", 0)),
        open_reports=sum(1 for r in reports if r.state == "open"),
        resolved_reports=sum(1 for r in reports if r.state == "resolved"),
        median_hours_to_resolve=round(hours[len(hours) // 2], 1) if hours else None,
        input_tokens=sum(a.input_tokens or 0 for a in answers),
        output_tokens=sum(a.output_tokens or 0 for a in answers),
        cost_usd=round(sum(costs), 4) if costs else None,
        by_day=[{"day": d, **v} for d, v in sorted(by_day.items())],
        top_unanswered=[UnansweredOut(question=q, times=n) for q, n in unanswered.most_common(10)],
        top_cited=[{"title": t, "times": n} for t, n in cited.most_common(5)],
    )
