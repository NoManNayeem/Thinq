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

from app.api.deps import DbDep, Principal, PrincipalDep, client_ip
from app.core.errors import AppError, NotFound
from app.models import (
    ChatMessage,
    Conversation,
    Document,
    DocumentStatus,
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
from app.services import audit
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


def _retrieval_for(principal: Principal, retrieval: dict[str, Any]) -> dict[str, Any]:
    """Members see counts; Admins also see the ranked candidates (titles they can already see)."""
    if principal.user.is_admin:
        return retrieval
    return {k: v for k, v in retrieval.items() if k != "candidates"}


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
                notices=[WITHHELD] if withheld else [NoticeOut(**n) for n in m.notices],
                retrieval={} if withheld else _retrieval_for(principal, m.retrieval),
                feedback=FeedbackOut(rating=fb.rating, reason=fb.reason, comment=fb.comment)
                if fb
                else None,
            )
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
                Document.is_registered.is_(True), Document.status == DocumentStatus.APPROVED.value
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
    notices = [{"kind": n.kind, "message": n.message} for n in engine.notices(result)]
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
        target_label=conversation.title,
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
                    notices=notices,
                    retrieval=retrieval,
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
                        for src in sources
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
    feedback = await db.get(MessageFeedback, (message.id, principal.user.id))
    if feedback is None:
        feedback = MessageFeedback(
            message_id=message.id, user_id=principal.user.id, rating=body.rating
        )
        db.add(feedback)
    feedback.rating = body.rating
    feedback.reason = body.reason if body.rating == "down" else None
    feedback.comment = (body.comment or "").strip() or None
    await db.commit()
    return FeedbackOut(rating=body.rating, reason=feedback.reason, comment=feedback.comment)


@router.delete(
    "/messages/{message_id}/feedback", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS
)
async def clear_feedback(message_id: uuid.UUID, principal: PrincipalDep, db: DbDep) -> None:
    message = await _own_assistant_message(db, principal, message_id)
    feedback = await db.get(MessageFeedback, (message.id, principal.user.id))
    if feedback is not None:
        await db.delete(feedback)
        await db.commit()
