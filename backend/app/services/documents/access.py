"""The one place that decides which documents a person can see.

Rule (from the brief): a user may see a document only if they belong to its access group.
Admins additionally see documents that have *no* access group — unregistered files and
documents whose manifest group doesn't exist — so someone can triage them. The Admin role
never grants access to a document that belongs to a group the Admin isn't in.

Every read of documents must go through :func:`visible_documents`. Retrieval for the
assistant (Task 5) reuses it, so the AI can never see more than the person asking.
"""

import uuid

from sqlalchemy import ColumnElement, Select, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.core.errors import NotFound
from app.models import Document


def visibility_clause(principal: Principal) -> ColumnElement[bool]:
    group_ids = [g.id for g in principal.groups]
    in_group = Document.access_group_id.in_(group_ids) if group_ids else false()
    if principal.user.is_admin:
        return or_(in_group, Document.access_group_id.is_(None))
    return in_group


def visible_documents(principal: Principal) -> Select[Document]:
    return select(Document).where(visibility_clause(principal))


async def get_visible_document(
    db: AsyncSession, principal: Principal, document_id: uuid.UUID
) -> Document:
    """Fetch a document the principal may see, or raise 404 — never 403, so hidden documents
    can't be confirmed to exist."""
    document = await db.scalar(visible_documents(principal).where(Document.id == document_id))
    if document is None:
        raise NotFound("Document not found.")
    return document
