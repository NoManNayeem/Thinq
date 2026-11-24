import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.documents import DocumentRef

Reason = Literal["wrong", "outdated", "missing_source", "not_relevant", "other"]
Resolution = Literal["fixed", "no_change", "marked_outdated", "duplicate"]


class FeedbackItemOut(BaseModel):
    id: uuid.UUID
    kind: Literal["answer", "document"]
    state: Literal["open", "resolved", "withdrawn"]
    reason: str
    comment: str | None
    question: str | None
    answer_excerpt: str | None
    document: DocumentRef | None = Field(description="Only when the viewer can see it")
    document_title: str | None
    reporter_name: str
    assigned_to: str = Field(description="The assignee's name, or Admins")
    created_at: datetime
    resolution: Resolution | None
    resolution_note: str | None
    resolved_by_name: str | None
    resolved_at: datetime | None
    can_resolve: bool


class InboxOut(BaseModel):
    items: list[FeedbackItemOut]
    open_count: int


class ResolveIn(BaseModel):
    resolution: Resolution
    note: str | None = Field(default=None, max_length=2000)
    mark_document_outdated: bool = False


class ReportDocumentIn(BaseModel):
    reason: Reason
    comment: str | None = Field(default=None, max_length=2000)


class ReportOutcome(BaseModel):
    state: Literal["open", "resolved", "withdrawn"]
    resolution: Resolution | None
    resolution_note: str | None
    resolved_by_name: str | None
    resolved_at: datetime | None
    assigned_to: str
