import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import Email, GroupRef, Password, Schema, UserOut


class LoginIn(BaseModel):
    email: Email
    password: str = Field(min_length=1, max_length=256)


class DemoLoginIn(BaseModel):
    user_id: uuid.UUID


class SessionInfo(Schema):
    expires_at: datetime


class MeOut(BaseModel):
    user: UserOut
    session: SessionInfo


class AuthConfigOut(BaseModel):
    demo_mode: bool
    password_min_length: int


class DemoUserOut(Schema):
    id: uuid.UUID
    name: str
    title: str | None
    role: Literal["member", "admin"]
    groups: list[GroupRef]


class PasswordChangeIn(BaseModel):
    current_password: str | None = Field(default=None, max_length=256)
    new_password: Password
