import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import GroupRef, Schema

DocumentStatusName = Literal["approved", "draft", "outdated", "reference", "unknown"]


class OwnerOut(BaseModel):
    name: str | None
    user_id: uuid.UUID | None
    has_account: bool


class FlagOut(Schema):
    id: int
    kind: str
    severity: Literal["critical", "warning", "info"]
    message: str
    details: dict[str, Any]
    created_at: datetime
    resolved_at: datetime | None
    resolution: str | None
    resolution_note: str | None


class DocumentSummary(BaseModel):
    id: uuid.UUID
    title: str
    source_path: str
    external_id: str | None
    status: DocumentStatusName
    owner: OwnerOut
    access_group: GroupRef | None
    last_modified: date | None
    last_reviewed: date | None
    is_registered: bool
    source_present: bool
    current_version: int
    updated_at: datetime
    open_flag_count: int | None = Field(description="Admins only; null for Members")
    match: str | None = Field(
        default=None, description="Snippet around a search match in the content"
    )


class DocumentRef(BaseModel):
    id: uuid.UUID
    title: str
    status: DocumentStatusName


class FamilyMemberOut(DocumentRef):
    last_modified: date | None
    last_reviewed: date | None
    is_current: bool = Field(description="The family's Approved version")
    is_self: bool


class ProposalOut(BaseModel):
    id: int
    document: DocumentRef
    proposed_status: DocumentStatusName
    evidence: DocumentRef
    evidence_text: str
    state: Literal["open", "accepted", "rejected", "superseded"]
    created_at: datetime


class StatusChangeOut(BaseModel):
    id: int
    action: str
    from_status: DocumentStatusName
    to_status: DocumentStatusName
    actor_name: str | None
    note: str | None
    evidence: DocumentRef | None
    created_at: datetime


class DocumentListOut(BaseModel):
    items: list[DocumentSummary]
    total: int
    status_counts: dict[str, int]


class DocumentDetail(DocumentSummary):
    content: str
    audience_count: int = Field(description="Active people who can see this document")
    flags: list[FlagOut] | None = Field(description="Admins only; null for Members")
    source_kind: Literal["folder", "upload"] = "folder"
    family: list[FamilyMemberOut] = Field(
        default_factory=list, description="Versions of this document the person can see"
    )
    superseded_by: DocumentRef | None = None
    can_change_status: bool = False
    review_due: date | None = None
    review_overdue: bool = False
    proposals: list[ProposalOut] = Field(
        default_factory=list, description="Open proposals, for people who can decide them"
    )


class VersionOut(BaseModel):
    version: int
    content_hash: str
    created_at: datetime
    is_current: bool


class VersionDetail(VersionOut):
    content: str


class DocumentUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    owner_name: str | None = Field(default=None, max_length=200)
    owner_user_id: uuid.UUID | None = None
    access_group_id: uuid.UUID | None = None


class DocumentRegisterIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    access_group_id: uuid.UUID
    owner_name: str | None = Field(default=None, max_length=200)
    owner_user_id: uuid.UUID | None = None


class FlagDismissIn(BaseModel):
    note: str = Field(min_length=3, max_length=1000)


class AttentionItem(DocumentSummary):
    flags: list[FlagOut]


class ScanOut(Schema):
    id: int
    started_at: datetime
    finished_at: datetime | None
    stats: dict[str, Any]
    trigger: str = "manual"
    error: str | None = None


StatusAction = Literal[
    "approve", "mark_outdated", "mark_reference", "mark_draft", "reject", "review"
]


class StatusActionIn(BaseModel):
    action: StatusAction
    note: str | None = Field(default=None, max_length=1000)


class ProposalDecisionIn(BaseModel):
    accept: bool
    note: str | None = Field(default=None, max_length=1000)


class ApprovalItem(DocumentSummary):
    reason: Literal["awaiting_approval", "status_unknown", "review_overdue"]
    review_due: date | None = None


class ApprovalsOut(BaseModel):
    documents: list[ApprovalItem]
    proposals: list[ProposalOut]


class UploadIn(BaseModel):
    filename: str = Field(min_length=1, max_length=200, pattern=r"^[^/\\]+\.(md|markdown|txt)$")
    content: str = Field(min_length=1)
    title: str | None = Field(default=None, max_length=300)
    access_group_id: uuid.UUID
    owner_name: str | None = Field(default=None, max_length=200)
    owner_user_id: uuid.UUID | None = None
    status: Literal["draft", "approved", "reference", "unknown"] = "draft"
