"""Feedback loop: flags on answers and documents reach the person who can fix them.

Routing
- A "not helpful" answer creates one item per cited document, for that document's owner when the
  owner has an active account and can see the document; otherwise for Admins.
- An answer with no sources (a gap in the documentation) goes to Admins.
- A report on a document goes the same way.

The reporter's question and the answer are shared with whoever receives the item: the reporter is
told this before they send it. Changing the rating to "helpful" withdraws their open items.
"""

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.core.errors import AppError, NotFound
from app.models import ChatMessage, Document, FeedbackItem, User
from app.services import audit
from app.services.access import effective_groups

RESOLUTIONS = {"fixed", "no_change", "marked_outdated", "duplicate"}


async def _can_see(db: AsyncSession, user: User, doc: Document) -> bool:
    if doc.access_group_id is None:
        return user.is_admin
    return doc.access_group_id in {g.id for g in await effective_groups(db, user)}


async def assignee_for(db: AsyncSession, doc: Document | None) -> uuid.UUID | None:
    """The document's owner if they can act on it, else None (meaning: Admins)."""
    if doc is None or doc.owner_user_id is None:
        return None
    owner = await db.get(User, doc.owner_user_id)
    if owner is None or not owner.is_active or not await _can_see(db, owner, doc):
        return None
    return owner.id


async def _question_before(db: AsyncSession, message: ChatMessage) -> str | None:
    question = await db.scalar(
        select(ChatMessage.content)
        .where(
            ChatMessage.conversation_id == message.conversation_id,
            ChatMessage.role == "user",
            ChatMessage.created_at <= message.created_at,
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    return question[:2000] if question else None


async def on_answer_feedback(
    db: AsyncSession,
    *,
    reporter: User,
    message: ChatMessage,
    rating: str,
    reason: str | None,
    comment: str | None,
) -> list[FeedbackItem]:
    if rating != "down":
        await withdraw(db, reporter=reporter, message_id=message.id)
        return []
    question = await _question_before(db, message)
    excerpt = (message.content or "")[:1200] or None
    docs: list[Document | None] = []
    # The documents the answer actually relied on: its [n] markers, or every source if it has none.
    cited = {int(n) for n in re.findall(r"\[(\d{1,2})\]", message.content or "")}
    relied_on = [s for s in message.sources if s.rank in cited] or list(message.sources)
    for src in sorted(relied_on, key=lambda s: s.rank):
        if src.document_id is not None:
            doc = await db.get(Document, src.document_id)
            if doc is not None and doc not in docs:
                docs.append(doc)
    if not docs:
        docs = [None]  # nothing cited: a gap, for Admins
    open_items = {
        i.document_id: i
        for i in (
            await db.scalars(
                select(FeedbackItem).where(
                    FeedbackItem.message_id == message.id,
                    FeedbackItem.reporter_id == reporter.id,
                    FeedbackItem.state == "open",
                )
            )
        ).all()
    }
    items = []
    for doc in docs:
        item = open_items.get(doc.id if doc else None)
        if item is None:
            item = FeedbackItem(
                kind="answer",
                reporter_id=reporter.id,
                message_id=message.id,
                document_id=doc.id if doc else None,
                document_title=doc.title if doc else None,
                assignee_id=await assignee_for(db, doc),
                state="open",
                reason=reason or "other",
            )
            db.add(item)
        item.reason = reason or "other"
        item.comment = comment
        item.question = question
        item.answer_excerpt = excerpt
        items.append(item)
    await db.flush()
    return items


async def withdraw(db: AsyncSession, *, reporter: User, message_id: uuid.UUID) -> None:
    await db.execute(
        update(FeedbackItem)
        .where(
            FeedbackItem.message_id == message_id,
            FeedbackItem.reporter_id == reporter.id,
            FeedbackItem.state == "open",
        )
        .values(state="withdrawn", resolved_at=datetime.now(UTC))
    )


async def report_document(
    db: AsyncSession, *, reporter: User, doc: Document, reason: str, comment: str | None
) -> FeedbackItem:
    item = FeedbackItem(
        kind="document",
        reporter_id=reporter.id,
        document_id=doc.id,
        document_title=doc.title,
        assignee_id=await assignee_for(db, doc),
        reason=reason,
        comment=comment,
        state="open",
    )
    db.add(item)
    await db.flush()
    return item


def inbox_clause(principal: Principal) -> ColumnElement[bool]:
    mine = FeedbackItem.assignee_id == principal.user.id
    if principal.user.is_admin:
        return or_(mine, FeedbackItem.assignee_id.is_(None))
    return mine


def can_resolve(principal: Principal, item: FeedbackItem) -> bool:
    if item.assignee_id == principal.user.id:
        return True
    return principal.user.is_admin and item.assignee_id is None


async def resolve(
    db: AsyncSession,
    *,
    principal: Principal,
    item_id: uuid.UUID,
    resolution: str,
    note: str | None,
    ip_address: str | None,
) -> FeedbackItem:
    item = await db.get(FeedbackItem, item_id)
    # The assignee resolves; an Admin may too (oversight) if they can see the document.
    if item is None or not (can_resolve(principal, item) or principal.user.is_admin):
        raise NotFound("Item not found.")
    if item.assignee_id != principal.user.id and item.document_id is not None:
        doc = await db.get(Document, item.document_id)
        if doc is None or not await _can_see(db, principal.user, doc):
            raise NotFound("Item not found.")
    if item.state != "open":
        raise AppError("This item is already closed.", code="closed")
    if resolution not in RESOLUTIONS:
        raise AppError("Unknown resolution.", code="unknown_resolution")
    item.state = "resolved"
    item.resolution = resolution
    item.resolution_note = (note or "").strip() or None
    item.resolved_by_id = principal.user.id
    item.resolved_at = datetime.now(UTC)
    await audit.record(
        db,
        actor=principal.user,
        action="feedback.resolved",
        details={
            "item": str(item.id),
            "resolution": resolution,
            "document": str(item.document_id) if item.document_id else None,
        },
        ip_address=ip_address,
    )
    await db.flush()
    return item
