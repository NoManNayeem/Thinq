"""Who can see which conversations and answers.

- A conversation belongs to one person. Anyone else — Admins included — gets 404.
- An answer is shown only while the reader can still see every document it cited. If they
  can't, the answer is *withheld*: its text and sources are hidden, and it's left out of any
  context sent to an answer engine. This is how "removing access applies to the very next
  question" holds for chat history too.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import Principal
from app.core.errors import NotFound
from app.models import ChatMessage, Conversation, Document, MessageSource
from app.services.documents.access import visibility_clause


async def get_own_conversation(
    db: AsyncSession,
    principal: Principal,
    conversation_id: uuid.UUID,
    *,
    with_messages: bool = False,
) -> Conversation:
    stmt = select(Conversation).where(
        Conversation.id == conversation_id, Conversation.user_id == principal.user.id
    )
    if with_messages:
        stmt = stmt.options(selectinload(Conversation.messages).selectinload(ChatMessage.sources))
    conversation = await db.scalar(stmt)
    if conversation is None:
        raise NotFound("Conversation not found.")
    return conversation


async def withheld_message_ids(
    db: AsyncSession, principal: Principal, messages: list[ChatMessage]
) -> set[uuid.UUID]:
    """Answers that cited at least one document the principal can't see right now."""
    cited: dict[uuid.UUID, set[uuid.UUID | None]] = {}
    for message in messages:
        if message.role == "assistant" and message.sources:
            cited[message.id] = {s.document_id for s in message.sources}
    if not cited:
        return set()
    every_doc = {d for docs in cited.values() for d in docs if d is not None}
    visible = set(
        (
            await db.scalars(
                select(Document.id).where(Document.id.in_(every_doc), visibility_clause(principal))
            )
        ).all()
    )
    return {
        message_id
        for message_id, docs in cited.items()
        # A deleted document (None) counts as no longer visible.
        if any(d is None or d not in visible for d in docs)
    }


async def engine_context(
    db: AsyncSession, principal: Principal, conversation: Conversation
) -> list[tuple[str, str]]:
    """The conversation as an engine may see it: (role, text) pairs, withheld answers removed.

    When an answer is withheld, the question that produced it is dropped too, so nothing about
    the hidden content survives in the context.
    """
    messages = list(conversation.messages)
    hidden = await withheld_message_ids(db, principal, messages)
    context: list[tuple[str, str]] = []
    for i, message in enumerate(messages):
        if message.id in hidden:
            continue
        nxt = messages[i + 1] if i + 1 < len(messages) else None
        if message.role == "user" and nxt is not None and nxt.id in hidden:
            continue
        if message.status == "error":
            continue
        context.append((message.role, message.content))
    return context


__all__ = ["MessageSource", "engine_context", "get_own_conversation", "withheld_message_ids"]
