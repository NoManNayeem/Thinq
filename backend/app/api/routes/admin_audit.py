import uuid

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import AdminDep, DbDep
from app.models import AuditEvent
from app.schemas.admin import AuditEventOut, AuditListOut
from app.schemas.common import ErrorResponse

router = APIRouter(prefix="/admin/audit", tags=["admin: audit"])


@router.get("", response_model=AuditListOut, responses={403: {"model": ErrorResponse}})
async def list_events(
    _: AdminDep,
    db: DbDep,
    action: str | None = Query(
        default=None, max_length=64, description="Exact action or prefix ending in '.'"
    ),
    actor_id: uuid.UUID | None = None,
    target_id: str | None = Query(default=None, max_length=64),
    before: int | None = Query(
        default=None, ge=1, description="Cursor: return events older than this id"
    ),
    limit: int = Query(default=50, ge=1, le=200),
) -> AuditListOut:
    stmt = select(AuditEvent)
    if action:
        stmt = stmt.where(
            AuditEvent.action.startswith(action)
            if action.endswith(".")
            else AuditEvent.action == action
        )
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)
    if target_id:
        stmt = stmt.where(AuditEvent.target_id == target_id)
    if before:
        stmt = stmt.where(AuditEvent.id < before)
    rows = (await db.scalars(stmt.order_by(AuditEvent.id.desc()).limit(limit + 1))).all()
    items = [AuditEventOut.model_validate(r) for r in rows[:limit]]
    return AuditListOut(items=items, next_cursor=items[-1].id if len(rows) > limit else None)
