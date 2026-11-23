import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.core.security import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(value: str) -> str:
    value = value.strip().lower()
    if not _EMAIL_RE.match(value) or len(value) > 320:
        raise ValueError("Enter a valid email address.")
    return value


Email = Annotated[str, AfterValidator(_normalize_email)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Password = Annotated[str, Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)]


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class GroupRef(Schema):
    id: uuid.UUID
    slug: str
    name: str
    is_system: bool


class UserOut(Schema):
    id: uuid.UUID
    email: str
    name: str
    title: str | None
    role: Literal["member", "admin"]
    is_active: bool
    has_password: bool
    last_login_at: datetime | None
    created_at: datetime
    groups: list[GroupRef]


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


def error_responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI ``responses`` entries for the given error status codes."""
    return {code: {"model": ErrorResponse} for code in codes}
