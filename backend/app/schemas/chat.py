import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.documents import DocumentStatusName

MAX_QUESTION_CHARS = 4000


class SourceOut(BaseModel):
    n: int
    document_id: uuid.UUID | None
    title: str
    status: DocumentStatusName
    owner_name: str | None
    last_reviewed: date | None
    access_group: str | None
    access_group_is_system: bool
    excerpt: str
    version: int


class NoticeOut(BaseModel):
    kind: str
    message: str


class FeedbackOut(BaseModel):
    rating: Literal["up", "down"]
    reason: str | None
    comment: str | None


class ChatMessageOut(BaseModel):
    id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    status: Literal["complete", "stopped", "error"]
    created_at: datetime
    withheld: bool = Field(description="True when it cited a document the reader can no longer see")
    sources: list[SourceOut]
    notices: list[NoticeOut]
    retrieval: dict[str, Any]
    feedback: FeedbackOut | None


class ConversationOut(BaseModel):
    id: uuid.UUID
    title: str
    pinned: bool
    created_at: datetime
    updated_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[ChatMessageOut]


class ConversationCreateIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class ConversationUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


class SendMessageIn(BaseModel):
    text: str = Field(default="", max_length=MAX_QUESTION_CHARS)
    trigger: Literal["submit-message", "regenerate-message"] = "submit-message"


class FeedbackIn(BaseModel):
    rating: Literal["up", "down"]
    reason: Literal["wrong", "outdated", "missing_source", "not_relevant", "other"] | None = None
    comment: str | None = Field(default=None, max_length=2000)


class ChatConfigOut(BaseModel):
    engine: str
    model: str | None
    max_question_chars: int
    suggestions: list[str]
    answering_from: list[str] = Field(description="Names of the groups answers can come from")
