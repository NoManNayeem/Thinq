import re

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict
from app.models import Group, Membership, User
from app.services import audit


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:64] or "group"


async def _name_taken(db: AsyncSession, name: str, *, exclude: Group | None = None) -> bool:
    stmt = select(Group.id).where(func.lower(Group.name) == name.lower())
    if exclude is not None:
        stmt = stmt.where(Group.id != exclude.id)
    return await db.scalar(stmt) is not None


async def create_group(
    db: AsyncSession, *, actor: User, name: str, description: str | None, ip_address: str | None
) -> Group:
    if await _name_taken(db, name):
        raise Conflict("A group with this name already exists.", code="group_name_taken")
    base = slugify(name)
    slug, n = base, 2
    while await db.scalar(select(Group.id).where(Group.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    group = Group(name=name, slug=slug, description=(description or "").strip() or None)
    db.add(group)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise Conflict("A group with this name already exists.", code="group_name_taken") from exc
    await audit.record(db, actor=actor, action="group.created", target=group, ip_address=ip_address)
    return group


async def update_group(
    db: AsyncSession,
    *,
    actor: User,
    group: Group,
    name: str | None,
    description: str | None,
    description_set: bool,
    ip_address: str | None,
) -> Group:
    changes: dict[str, dict[str, str | None]] = {}
    if name is not None and name != group.name:
        if group.is_system:
            raise Conflict("System groups can't be renamed.", code="system_group")
        if await _name_taken(db, name, exclude=group):
            raise Conflict("A group with this name already exists.", code="group_name_taken")
        changes["name"] = {"from": group.name, "to": name}
        group.name = name
    if description_set:
        new = (description or "").strip() or None
        if new != group.description:
            changes["description"] = {"from": group.description, "to": new}
            group.description = new
    if changes:
        await audit.record(
            db,
            actor=actor,
            action="group.updated",
            target=group,
            details=changes,
            ip_address=ip_address,
        )
    await db.flush()
    return group


async def delete_group(
    db: AsyncSession, *, actor: User, group: Group, ip_address: str | None
) -> None:
    if group.is_system:
        raise Conflict("System groups can't be deleted.", code="system_group")
    members = int(
        await db.scalar(
            select(func.count()).select_from(Membership).where(Membership.group_id == group.id)
        )
        or 0
    )
    await audit.record(
        db,
        actor=actor,
        action="group.deleted",
        target=group,
        details={"members_removed": members},
        ip_address=ip_address,
    )
    await db.delete(group)
    await db.flush()
