import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import anyio
import structlog
from fastapi import APIRouter, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import DbDep, Principal, PrincipalDep, client_ip
from app.core.errors import AppError, NotFound, TooManyRequests
from app.models import (
    ChatMessage,
    Conversation,
    Document,
    DocumentStatus,
    FeedbackItem,
    MessageFeedback,
    MessageSource,
)
from app.schemas.chat import (
    MAX_QUESTION_CHARS,
    ChatConfigOut,
    ChatMessageOut,
    ConversationCreateIn,
    ConversationDetail,
    ConversationOut,
    ConversationUpdateIn,
    FeedbackIn,
    FeedbackOut,
    NoticeOut,
    SendMessageIn,
    SourceOut,
)
from app.schemas.common import error_responses
from app.schemas.feedback import ReportOutcome
from app.services import audit
from app.services import feedback as feedback_service
from app.services.chat.access import engine_context, get_own_conversation, withheld_message_ids
from app.services.chat.engines import get_engine
from app.services.chat.retrieval import retrieve
from app.services.chat.stream import HEADERS, done, event
from app.services.documents.access import visible_documents
from app.services.knowledge.cognee_client import CogneeError
from app.services.knowledge.service import KnowledgeService, SemanticHit

router = APIRouter(prefix="/chat", tags=["chat"])
log = structlog.get_logger(__name__)
ERRORS = error_responses(401, 404)
DEFAULT_TITLE = "New chat"
WITHHELD = NoticeOut(
    kind="withheld",
    message="This answer used a document you no longer have access to, so it's hidden.",
)


REFUSAL_MARKERS = ("couldn't find", "could not find", "can't find", "cannot find")


def is_refusal(text: str) -> bool:
    """An answer that says nothing it may use answers the question (checked on its opening)."""
    head = text.strip().lower()[:160]
    return any(m in head for m in REFUSAL_MARKERS)


def _check_question_rate(request: Request, principal: Principal) -> None:
    """Questions cost money and compute: at most N per person per minute."""
    limit = request.app.state.settings.chat_questions_per_minute
    if limit <= 0:
        return
    store: dict[uuid.UUID, list[float]] | None = getattr(request.app.state, "question_times", None)
    if store is None:
        store = request.app.state.question_times = {}
    now = time.monotonic()
    recent = [t for t in store.get(principal.user.id, []) if now - t < 60]
    if len(recent) >= limit:
        raise TooManyRequests(
            "You're asking very quickly. Wait a moment and try again.",
            retry_after_s=max(1, int(60 - (now - recent[0]))),
        )
    recent.append(now)
    store[principal.user.id] = recent


def _usage(engine: object, key: str) -> Any:
    usage = getattr(engine, "usage", None)
    return usage.get(key) if isinstance(usage, dict) else None


def _retrieval_for(
    principal: Principal, retrieval: dict[str, Any], visible: set[str] | None = None
) -> dict[str, Any]:
    """Members see counts; Admins also see the ranked candidates, limited to documents they can
    see now (``visible``, when reading a stored answer)."""
    if not principal.user.is_admin:
        return {k: v for k, v in retrieval.items() if k != "candidates"}
    if visible is None:
        return retrieval
    candidates = [c for c in retrieval.get("candidates", []) if str(c.get("id")) in visible]
    return {**retrieval, "candidates": candidates}


def _notices_for(stored: list[dict[str, Any]], visible: set[str]) -> list[NoticeOut]:
    """Notices name documents; keep only those whose documents the reader can still see."""
    return [
        NoticeOut(kind=n["kind"], message=n["message"])
        for n in stored
        if all(d in visible for d in n.get("documents", []))
    ]


def _source_out(s: MessageSource) -> SourceOut:
    return SourceOut(
        n=s.rank,
        document_id=s.document_id,
        title=s.title,
        status=s.status,
        owner_name=s.owner_name,
        last_reviewed=s.last_reviewed,
        access_group=s.access_group_name,
        access_group_is_system=s.access_group_is_system,
        excerpt=s.excerpt,
        version=s.document_version,
    )


async def _messages_out(
    db: AsyncSession, principal: Principal, conversation: Conversation
) -> list[ChatMessageOut]:
    messages = list(conversation.messages)
    hidden = await withheld_message_ids(db, principal, messages)
    feedback = {
        f.message_id: f
        for f in (
            await db.scalars(
                select(MessageFeedback).where(
                    MessageFeedback.message_id.in_([m.id for m in messages]),
                    MessageFeedback.user_id == principal.user.id,
                )
            )
        ).all()
    }
    reports = await report_outcomes(db, principal, [m.id for m in messages])
    visible = {
        str(i)
        for i in (
            await db.scalars(visible_documents(principal).with_only_columns(Document.id))
        ).all()
    }
    out: list[ChatMessageOut] = []
    for m in messages:
        withheld = m.id in hidden
        fb = feedback.get(m.id)
        out.append(
            ChatMessageOut(
                id=m.id,
                role=m.role,
                content="" if withheld else m.content,
                status=m.status,
                created_at=m.created_at,
                withheld=withheld,
                sources=[] if withheld else [_source_out(s) for s in m.sources],
                notices=[WITHHELD] if withheld else _notices_for(m.notices, visible),
                retrieval={} if withheld else _retrieval_for(principal, m.retrieval, visible),
                feedback=FeedbackOut(
                    rating=fb.rating,
                    reason=fb.reason,
                    comment=fb.comment,
                    report=reports.get(m.id),
                )
                if fb
                else None,
            )
        )
    return out


async def report_outcomes(
    db: AsyncSession, principal: Principal, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, ReportOutcome]:
    """What happened to this person's reports on these answers: open until every item is
    closed, then the latest resolution."""
    if not message_ids:
        return {}
    rows = (
        await db.scalars(
            select(FeedbackItem)
            .where(
                FeedbackItem.message_id.in_(message_ids),
                FeedbackItem.reporter_id == principal.user.id,
                FeedbackItem.state != "withdrawn",
            )
            .options(selectinload(FeedbackItem.assignee), selectinload(FeedbackItem.resolved_by))
            .order_by(FeedbackItem.created_at)
        )
    ).all()
    grouped: dict[uuid.UUID, list[FeedbackItem]] = {}
    for item in rows:
        if item.message_id is not None:
            grouped.setdefault(item.message_id, []).append(item)
    out = {}
    for message_id, items in grouped.items():
        pending = [i for i in items if i.state == "open"]
        done = sorted(
            (i for i in items if i.state == "resolved"), key=lambda i: i.resolved_at or i.created_at
        )
        ref = pending[0] if pending else done[-1]
        out[message_id] = ReportOutcome(
            state="open" if pending else "resolved",
            resolution=None if pending else ref.resolution,
            resolution_note=None if pending else ref.resolution_note,
            resolved_by_name=None
            if pending
            else (ref.resolved_by.name if ref.resolved_by else None),
            resolved_at=None if pending else ref.resolved_at,
            assigned_to=", ".join(
                sorted({i.assignee.name if i.assignee else "Admins" for i in items})
            ),
        )
    return out


def _conversation_out(c: Conversation) -> ConversationOut:
    return ConversationOut(
        id=c.id, title=c.title, pinned=c.pinned, created_at=c.created_at, updated_at=c.updated_at
    )


@router.get("/config", response_model=ChatConfigOut, responses=ERRORS)
async def chat_config(principal: PrincipalDep, db: DbDep, request: Request) -> ChatConfigOut:
    engine = get_engine(request.app.state.settings)
    suggestions_docs = (
        await db.scalars(
            visible_documents(principal)
            .where(
                Document.is_registered.is_(True),
                Document.source_present.is_(True),
                Document.status == DocumentStatus.APPROVED.value,
            )
            .order_by(Document.last_reviewed.desc().nulls_last(), Document.title)
            .limit(4)
        )
    ).all()
    return ChatConfigOut(
        engine=engine.name,
        model=engine.model,
        max_question_chars=MAX_QUESTION_CHARS,
        suggestions=[f"What does “{d.title}” say?" for d in suggestions_docs],
        answering_from=[g.name for g in principal.groups],
    )


@router.get("/conversations", response_model=list[ConversationOut], responses=ERRORS)
async def list_conversations(principal: PrincipalDep, db: DbDep) -> list[ConversationOut]:
    rows = (
        await db.scalars(
            select(Conversation)
            .where(Conversation.user_id == principal.user.id)
            .order_by(Conversation.pinned.desc(), Conversation.updated_at.desc())
            .limit(200)
        )
    ).all()
    return [_conversation_out(c) for c in rows]


@router.post(
    "/conversations",
    response_model=ConversationOut,
    status_code=status.HTTP_201_CREATED,
    responses=ERRORS,
)
async def create_conversation(
    body: ConversationCreateIn, principal: PrincipalDep, db: DbDep
) -> ConversationOut:
    title = (body.title or "").strip()[:200] or DEFAULT_TITLE
    conversation = Conversation(user_id=principal.user.id, title=title)
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return _conversation_out(conversation)


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail, responses=ERRORS)
async def get_conversation(
    conversation_id: uuid.UUID, principal: PrincipalDep, db: DbDep
) -> ConversationDetail:
    conversation = await get_own_conversation(db, principal, conversation_id, with_messages=True)
    return ConversationDetail(
        **_conversation_out(conversation).model_dump(),
        messages=await _messages_out(db, principal, conversation),
    )


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut, responses=ERRORS)
async def update_conversation(
    conversation_id: uuid.UUID, body: ConversationUpdateIn, principal: PrincipalDep, db: DbDep
) -> ConversationOut:
    conversation = await get_own_conversation(db, principal, conversation_id)
    if body.title is not None:
        conversation.title = body.title.strip()[:200] or DEFAULT_TITLE
    if body.pinned is not None:
        conversation.pinned = body.pinned
    await db.commit()
    await db.refresh(conversation)
    return _conversation_out(conversation)


@router.delete(
    "/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS
)
async def delete_conversation(
    conversation_id: uuid.UUID, principal: PrincipalDep, db: DbDep
) -> None:
    conversation = await get_own_conversation(db, principal, conversation_id)
    await db.delete(conversation)
    await db.commit()


@router.post(
    "/conversations/{conversation_id}/messages",
    response_class=StreamingResponse,
    responses={**ERRORS, 400: error_responses(400)[400]},
    summary="Ask a question; the answer streams back as an AI SDK UI message stream",
)
async def send_message(
    conversation_id: uuid.UUID,
    body: SendMessageIn,
    principal: PrincipalDep,
    db: DbDep,
    request: Request,
) -> StreamingResponse:
    _check_question_rate(request, principal)
    conversation = await get_own_conversation(db, principal, conversation_id, with_messages=True)
    now = datetime.now(UTC)

    if body.trigger == "regenerate-message":
        while conversation.messages and conversation.messages[-1].role == "assistant":
            await db.delete(conversation.messages.pop())
        if not conversation.messages:
            raise AppError("There's no question to answer again.", code="nothing_to_regenerate")
        question = conversation.messages[-1].content
    else:
        question = body.text.strip()
        if not question:
            raise AppError("Type a question first.", code="empty_question")
        if not conversation.messages and conversation.title == DEFAULT_TITLE:
            conversation.title = question[:80] + ("…" if len(question) > 80 else "")
        conversation.messages.append(ChatMessage(role="user", content=question, status="complete"))
    conversation.updated_at = now
    await db.flush()

    history = (await engine_context(db, principal, conversation))[:-1]
    knowledge: KnowledgeService | None = request.app.state.knowledge
    semantic: list[SemanticHit] = []
    semantic_status = "off"
    if knowledge is not None:
        try:
            semantic = await knowledge.search(db, principal, question)
            semantic_status = "ok"
        except CogneeError as exc:
            semantic_status = "unavailable"  # fall back to lexical search, never fail the question
            log.warning("semantic search unavailable", error=str(exc)[:200])
    result = await retrieve(db, principal, question, semantic)
    engine = get_engine(request.app.state.settings)
    notices = [
        {"kind": n.kind, "message": n.message, "documents": [str(d) for d in n.document_ids]}
        for n in engine.notices(result)
    ]
    sources = [
        MessageSource(
            rank=i,
            document_id=p.document.id,
            document_version=p.document.current_version,
            title=p.document.title,
            status=p.document.status,
            owner_name=p.document.owner_name,
            last_reviewed=p.document.last_reviewed,
            access_group_name=p.document.access_group.name if p.document.access_group else None,
            access_group_is_system=bool(
                p.document.access_group and p.document.access_group.is_system
            ),
            excerpt=p.excerpt,
            score=round(p.score, 4),
        )
        for i, p in enumerate(result.passages, start=1)
    ]
    retrieval = {
        "engine": engine.name,
        "model": engine.model,
        "semantic": semantic_status,
        "searched": result.searched,
        "used": len(sources),
        "candidates": result.candidates,
    }
    assistant_id = uuid.uuid4()
    await audit.record(
        db,
        actor=principal.user,
        action="chat.asked",
        target_label="Question",
        details={
            "conversation_id": str(conversation.id),
            "message_id": str(assistant_id),
            "engine": engine.name,
            "documents": [str(s.document_id) for s in sources],
            "regenerated": body.trigger == "regenerate-message",
        },
        ip_address=client_ip(request),
    )
    await db.commit()

    sessionmaker = request.app.state.sessionmaker
    source_payload = [_source_out(s).model_dump(mode="json") for s in sources]
    visible_retrieval = _retrieval_for(principal, retrieval)

    kept: dict[str, Any] = {"sources": sources, "notices": notices}

    async def save(text: str, status_value: str) -> None:
        async with sessionmaker() as s:
            s.add(
                ChatMessage(
                    id=assistant_id,
                    conversation_id=conversation.id,
                    role="assistant",
                    content=text.strip(),
                    status=status_value,
                    engine=engine.name,
                    model=engine.model,
                    input_tokens=_usage(engine, "input_tokens"),
                    output_tokens=_usage(engine, "output_tokens"),
                    cost_usd=_usage(engine, "cost_usd"),
                    notices=kept["notices"],
                    retrieval={**retrieval, "used": len(kept["sources"])},
                    sources=[
                        MessageSource(
                            **{
                                k: getattr(src, k)
                                for k in (
                                    "rank",
                                    "document_id",
                                    "document_version",
                                    "title",
                                    "status",
                                    "owner_name",
                                    "last_reviewed",
                                    "access_group_name",
                                    "access_group_is_system",
                                    "excerpt",
                                    "score",
                                )
                            }
                        )
                        for src in kept["sources"]
                    ],
                )
            )
            await s.execute(
                update(Conversation)
                .where(Conversation.id == conversation.id)
                .values(updated_at=func.now())
            )
            await s.commit()

    async def stream() -> AsyncIterator[str]:
        parts: list[str] = []
        outcome = "stopped"
        try:
            yield event({"type": "start", "messageId": str(assistant_id)})
            yield event({"type": "data-retrieval", "id": "retrieval", "data": visible_retrieval})
            yield event(
                {"type": "data-sources", "id": "sources", "data": {"items": source_payload}}
            )
            yield event({"type": "data-notices", "id": "notices", "data": {"items": notices}})
            yield event({"type": "text-start", "id": "text"})
            async for chunk in engine.stream(question, result, history):
                parts.append(chunk)
                yield event({"type": "text-delta", "id": "text", "delta": chunk})
            yield event({"type": "text-end", "id": "text"})
            if sources and is_refusal("".join(parts)):
                # The answer says the sources don't answer the question, so listing them as
                # its sources would mislead. Replace them (same part ids) and store none.
                kept["sources"], kept["notices"] = [], []
                yield event({"type": "data-sources", "id": "sources", "data": {"items": []}})
                yield event({"type": "data-notices", "id": "notices", "data": {"items": []}})
                yield event(
                    {
                        "type": "data-retrieval",
                        "id": "retrieval",
                        "data": {**visible_retrieval, "used": 0},
                    }
                )
            yield event({"type": "finish"})
            yield done()
            outcome = "complete"
        except Exception:  # an engine failure must not leave the client hanging
            log.exception("answer failed", conversation_id=str(conversation.id))
            outcome = "error"
            yield event(
                {"type": "error", "errorText": "Thinq couldn't finish this answer. Try again."}
            )
            yield done()
        finally:
            # Runs on success, failure and when the client stops the stream (disconnect).
            with anyio.CancelScope(shield=True):
                try:
                    await save("".join(parts), outcome)
                except Exception:
                    log.exception("could not save answer", conversation_id=str(conversation.id))

    return StreamingResponse(stream(), media_type="text/event-stream", headers=HEADERS)


async def _own_assistant_message(
    db: AsyncSession, principal: Principal, message_id: uuid.UUID
) -> ChatMessage:
    message = await db.scalar(
        select(ChatMessage)
        .join(Conversation, Conversation.id == ChatMessage.conversation_id)
        .where(
            ChatMessage.id == message_id,
            ChatMessage.role == "assistant",
            Conversation.user_id == principal.user.id,
        )
    )
    if message is None:
        raise NotFound("Message not found.")
    return message


@router.put("/messages/{message_id}/feedback", response_model=FeedbackOut, responses=ERRORS)
async def give_feedback(
    message_id: uuid.UUID, body: FeedbackIn, principal: PrincipalDep, db: DbDep
) -> FeedbackOut:
    message = await _own_assistant_message(db, principal, message_id)
    fb = await db.get(MessageFeedback, (message.id, principal.user.id))
    if fb is None:
        fb = MessageFeedback(message_id=message.id, user_id=principal.user.id, rating=body.rating)
        db.add(fb)
    fb.rating = body.rating
    fb.reason = body.reason if body.rating == "down" else None
    fb.comment = (body.comment or "").strip() or None
    await db.refresh(message, ["sources"])
    await feedback_service.on_answer_feedback(
        db,
        reporter=principal.user,
        message=message,
        rating=body.rating,
        reason=fb.reason,
        comment=fb.comment,
    )
    await db.commit()
    reports = await report_outcomes(db, principal, [message.id])
    return FeedbackOut(
        rating=body.rating, reason=fb.reason, comment=fb.comment, report=reports.get(message.id)
    )


@router.delete(
    "/messages/{message_id}/feedback", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS
)
async def clear_feedback(message_id: uuid.UUID, principal: PrincipalDep, db: DbDep) -> None:
    message = await _own_assistant_message(db, principal, message_id)
    fb = await db.get(MessageFeedback, (message.id, principal.user.id))
    if fb is not None:
        await db.delete(fb)
    await feedback_service.withdraw(db, reporter=principal.user, message_id=message.id)
    await db.commit()
