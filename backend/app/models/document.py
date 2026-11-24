import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.group import Group
    from app.models.user import User


class DocumentStatus(StrEnum):
    """The brief's status values. ``unknown`` is the manifest's blank."""

    APPROVED = "approved"
    DRAFT = "draft"
    OUTDATED = "outdated"
    REFERENCE = "reference"
    UNKNOWN = "unknown"


class FlagSeverity(StrEnum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class Document(TimestampMixin, Base):
    """One file in an organization's shared drive, plus what Thinq knows about it.

    Visibility is decided only by ``access_group_id``: see ``app.services.documents.access``.
    A document with no access group is visible to Admins only.
    """

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint(
            "status IN ('approved', 'draft', 'outdated', 'reference', 'unknown')",
            name="status_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text("uuidv7()"))
    source_path: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DocumentStatus.UNKNOWN.value, server_default="unknown"
    )
    owner_name: Mapped[str | None] = mapped_column(String(200))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    access_group_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("groups.id", ondelete="SET NULL"), index=True
    )
    last_modified: Mapped[date | None] = mapped_column(Date)
    last_reviewed: Mapped[date | None] = mapped_column(Date)
    is_registered: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    source_present: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    current_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    # Versions of "the same document" share a family (e.g. checklist v3, v4 draft, 2024).
    family: Mapped[str | None] = mapped_column(String(200), index=True)
    superseded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL")
    )
    # Where the file comes from: the synced folder, or an upload in Thinq.
    source_kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="folder", server_default="folder"
    )
    # What the manifest said at the last scan, kept to explain drift.
    manifest: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    access_group: Mapped[Group | None] = relationship()
    owner_user: Mapped[User | None] = relationship()
    flags: Mapped[list[DocumentFlag]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="DocumentFlag.created_at"
    )


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version", name="document_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DocumentFlag(Base):
    """A data-quality problem found on a document.

    Flags are recomputed on every scan: new problems open a flag, problems that went away
    resolve theirs. A flag an Admin dismissed stays dismissed while its evidence
    (``fingerprint``) is unchanged.
    """

    __tablename__ = "document_flags"
    __table_args__ = (
        CheckConstraint("severity IN ('critical', 'warning', 'info')", name="severity_valid"),
        Index(
            "ix_document_flags_open", "document_id", postgresql_where=text("resolved_at IS NULL")
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution: Mapped[str | None] = mapped_column(String(16))  # fixed | dismissed
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolution_note: Mapped[str | None] = mapped_column(Text)

    document: Mapped[Document] = relationship(back_populates="flags")


class DocumentScan(Base):
    __tablename__ = "document_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    stats: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    trigger: Mapped[str] = mapped_column(
        String(16), nullable=False, default="manual", server_default="manual"
    )
    error: Mapped[str | None] = mapped_column(Text)


class DocumentStatusChange(Base):
    """Every change to a document's status or review, and who made it."""

    __tablename__ = "document_status_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    from_status: Mapped[str] = mapped_column(String(16), nullable=False)
    to_status: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    evidence_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    actor: Mapped[User | None] = relationship()


class StatusProposal(Base):
    """A status suggested by an approved document (e.g. a memo naming the current form).

    Never applied automatically: the owner or an Admin accepts or rejects it.
    """

    __tablename__ = "status_proposals"
    __table_args__ = (UniqueConstraint("document_id", "proposed_status", "evidence_document_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    proposed_status: Mapped[str] = mapped_column(String(16), nullable=False)
    evidence_document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    evidence_text: Mapped[str] = mapped_column(Text, nullable=False)
    # open | accepted | rejected | superseded (the status changed some other way)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)

    document: Mapped[Document] = relationship(foreign_keys=[document_id])
    evidence: Mapped[Document] = relationship(foreign_keys=[evidence_document_id])
