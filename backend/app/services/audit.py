from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent, Document, Group, User

SYSTEM_ACTOR = "system"


async def record(
    db: AsyncSession,
    *,
    actor: User | None,
    action: str,
    target: User | Group | Document | None = None,
    target_label: str | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> None:
    """Add an audit event to the current transaction. It commits with the change it describes."""
    target_type = target_id = None
    if isinstance(target, User):
        target_type, target_id, target_label = "user", str(target.id), target_label or target.email
    elif isinstance(target, Group):
        target_type, target_id, target_label = "group", str(target.id), target_label or target.name
    elif isinstance(target, Document):
        target_type, target_id, target_label = (
            "document",
            str(target.id),
            target_label or target.title,
        )
    db.add(
        AuditEvent(
            actor_id=actor.id if actor else None,
            actor_label=actor.email if actor else SYSTEM_ACTOR,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            details=details or {},
            ip_address=ip_address,
        )
    )
