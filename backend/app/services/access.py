"""Group membership resolution. This is the single source of truth for "which groups is X in"."""

import uuid
from collections.abc import Sequence

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group, Membership, User
from app.models.group import EVERYONE_SLUG


def _sort_key(group: Group) -> tuple[bool, str]:
    return (not group.is_system, group.name.lower())


async def effective_groups(db: AsyncSession, user: User) -> list[Group]:
    """Groups the user belongs to right now. Read from the database on every call, never cached."""
    explicit = select(Membership.group_id).where(Membership.user_id == user.id)
    conditions: list[ColumnElement[bool]] = [Group.id.in_(explicit)]
    if user.is_active:
        conditions.append(Group.slug == EVERYONE_SLUG)
    groups = (await db.scalars(select(Group).where(or_(*conditions)))).all()
    return sorted(groups, key=_sort_key)


async def effective_groups_for(
    db: AsyncSession, users: Sequence[User]
) -> dict[uuid.UUID, list[Group]]:
    """Batch version of :func:`effective_groups` for lists."""
    result: dict[uuid.UUID, list[Group]] = {u.id: [] for u in users}
    if not users:
        return result
    rows = await db.execute(
        select(Membership.user_id, Group)
        .join(Group, Group.id == Membership.group_id)
        .where(Membership.user_id.in_([u.id for u in users]))
    )
    for user_id, group in rows:
        result[user_id].append(group)
    everyone = await db.scalar(select(Group).where(Group.slug == EVERYONE_SLUG))
    for user in users:
        if everyone is not None and user.is_active:
            result[user.id].append(everyone)
        result[user.id].sort(key=_sort_key)
    return result


async def get_everyone_group(db: AsyncSession) -> Group | None:
    return await db.scalar(select(Group).where(Group.slug == EVERYONE_SLUG))
