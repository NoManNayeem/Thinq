"""What Thinq has sent to the optional Cognee knowledge layer.

Thinq owns this mapping. Cognee never decides who may see a document: a search hit is only
used after it has been mapped back to a Thinq document through this table and re-checked
against the asker's current access.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KnowledgeDataset(Base):
    """One Cognee dataset per access group ("datasets are walls"), plus one for unshared docs."""

    __tablename__ = "knowledge_datasets"

    # Group id, or the nil UUID for documents shared with no group (Admins only).
    scope_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    cognee_dataset_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class KnowledgeItem(Base):
    """One indexed document: which Cognee data item holds which version of it."""

    __tablename__ = "knowledge_items"

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    scope_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    cognee_dataset_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    cognee_data_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False)
    # pending: added, graph not built yet | indexed | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
