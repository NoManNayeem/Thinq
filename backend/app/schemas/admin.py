import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import Email, Name, OptionalText, Password, Schema, UserOut

RoleName = Literal["member", "admin"]


class UserListOut(BaseModel):
    items: list[UserOut]
    total: int


class UserDetailOut(UserOut):
    active_session_count: int


class UserCreateIn(BaseModel):
    email: Email
    name: Name
    title: OptionalText | None = None
    role: RoleName = "member"
    password: Password | None = None
    group_ids: list[uuid.UUID] = Field(default_factory=list)


class UserUpdateIn(BaseModel):
    name: Name | None = None
    title: OptionalText | None = None
    role: RoleName | None = None
    is_active: bool | None = None


class PasswordSetIn(BaseModel):
    new_password: Password


class GroupOut(Schema):
    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    is_system: bool
    member_count: int
    created_at: datetime


class GroupMemberOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    title: str | None
    role: RoleName
    is_active: bool
    added_at: datetime | None
    added_by: str | None


class GroupDetailOut(GroupOut):
    members: list[GroupMemberOut]


class GroupCreateIn(BaseModel):
    name: Name = Field(max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class GroupUpdateIn(BaseModel):
    name: Name | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class AuditEventOut(Schema):
    id: int
    occurred_at: datetime
    actor_id: uuid.UUID | None
    actor_label: str
    action: str
    target_type: str | None
    target_id: str | None
    target_label: str | None
    details: dict[str, Any]
    ip_address: str | None


class AuditListOut(BaseModel):
    items: list[AuditEventOut]
    next_cursor: int | None
