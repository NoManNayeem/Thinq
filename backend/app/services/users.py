"""User and membership changes, with the guard rails that keep an organization manageable."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.core.security import hash_password
from app.models import Group, Membership, Role, User
from app.models.group import EVERYONE_SLUG
from app.services import audit
from app.services.sessions import revoke_user_sessions


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFound("User not found.")
    return user


async def get_group(db: AsyncSession, group_id: uuid.UUID) -> Group:
    group = await db.get(Group, group_id)
    if group is None:
        raise NotFound("Group not found.")
    return group


async def _other_active_admins(db: AsyncSession, user: User) -> int:
    """Count active admins other than ``user``, locking their rows to prevent races."""
    rows = await db.scalars(
        select(User.id)
        .where(User.role == Role.ADMIN.value, User.is_active.is_(True), User.id != user.id)
        .with_for_update()
    )
    return len(rows.all())


async def create_user(
    db: AsyncSession,
    *,
    actor: User,
    email: str,
    name: str,
    title: str | None,
    role: str,
    password: str | None,
    group_ids: list[uuid.UUID],
    ip_address: str | None,
) -> User:
    if await db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("A user with this email already exists.", code="email_taken")
    groups = [await get_group(db, gid) for gid in dict.fromkeys(group_ids)]
    if any(g.is_system for g in groups):
        raise Conflict("Everyone includes all active users automatically.", code="system_group")
    user = User(
        email=email,
        name=name,
        title=title or None,
        role=role,
        is_active=True,
        password_hash=hash_password(password) if password else None,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise Conflict("A user with this email already exists.", code="email_taken") from exc
    for group in groups:
        db.add(Membership(user_id=user.id, group_id=group.id, created_by_id=actor.id))
    await audit.record(
        db,
        actor=actor,
        action="user.created",
        target=user,
        details={"role": role, "groups": [g.name for g in groups], "has_password": bool(password)},
        ip_address=ip_address,
    )
    return user


async def update_user(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    name: str | None,
    title: str | None,
    title_set: bool,
    role: str | None,
    is_active: bool | None,
    ip_address: str | None,
) -> User:
    changes: dict[str, dict[str, object]] = {}

    losing_admin = (role is not None and role != Role.ADMIN.value and user.is_admin) or (
        is_active is False and user.is_active and user.is_admin
    )
    if user.id == actor.id:
        if role is not None and role != user.role:
            raise Conflict("You can't change your own role.", code="self_role_change")
        if is_active is False:
            raise Conflict("You can't deactivate your own account.", code="self_deactivate")
    if losing_admin and await _other_active_admins(db, user) == 0:
        raise Conflict(
            "This is the only active Admin. Make someone else an Admin first.",
            code="last_admin",
        )

    if name is not None and name != user.name:
        changes["name"] = {"from": user.name, "to": name}
        user.name = name
    if title_set and (title or None) != user.title:
        changes["title"] = {"from": user.title, "to": title or None}
        user.title = title or None
    if role is not None and role != user.role:
        await audit.record(
            db,
            actor=actor,
            action="user.role_changed",
            target=user,
            details={"from": user.role, "to": role},
            ip_address=ip_address,
        )
        user.role = role
    if is_active is not None and is_active != user.is_active:
        user.is_active = is_active
        details: dict[str, object] = {}
        if not is_active:
            details["sessions_revoked"] = await revoke_user_sessions(db, user.id)
        await audit.record(
            db,
            actor=actor,
            action="user.reactivated" if is_active else "user.deactivated",
            target=user,
            details=details,
            ip_address=ip_address,
        )
    if changes:
        await audit.record(
            db,
            actor=actor,
            action="user.updated",
            target=user,
            details=changes,
            ip_address=ip_address,
        )
    await db.flush()
    return user


async def set_password(
    db: AsyncSession, *, actor: User, user: User, new_password: str, ip_address: str | None
) -> int:
    """Admin password reset. Signs the user out everywhere."""
    user.password_hash = hash_password(new_password)
    revoked = await revoke_user_sessions(db, user.id)
    await audit.record(
        db,
        actor=actor,
        action="user.password_reset",
        target=user,
        details={"sessions_revoked": revoked},
        ip_address=ip_address,
    )
    return revoked


async def add_membership(
    db: AsyncSession, *, actor: User, user: User, group: Group, ip_address: str | None
) -> bool:
    if group.is_system:
        raise Conflict("Everyone includes all active users automatically.", code="system_group")
    existing = await db.get(Membership, (user.id, group.id))
    if existing is not None:
        return False
    db.add(Membership(user_id=user.id, group_id=group.id, created_by_id=actor.id))
    await audit.record(
        db,
        actor=actor,
        action="membership.added",
        target=user,
        details={"group_id": str(group.id), "group": group.name},
        ip_address=ip_address,
    )
    await db.flush()
    return True


async def remove_membership(
    db: AsyncSession, *, actor: User, user: User, group: Group, ip_address: str | None
) -> bool:
    if group.is_system:
        raise Conflict("Everyone includes all active users automatically.", code="system_group")
    existing = await db.get(Membership, (user.id, group.id))
    if existing is None:
        return False
    await db.delete(existing)
    await audit.record(
        db,
        actor=actor,
        action="membership.removed",
        target=user,
        details={"group_id": str(group.id), "group": group.name},
        ip_address=ip_address,
    )
    await db.flush()
    return True


async def member_count(db: AsyncSession, group: Group) -> int:
    if group.slug == EVERYONE_SLUG:
        stmt = select(func.count()).select_from(User).where(User.is_active.is_(True))
    else:
        stmt = (
            select(func.count())
            .select_from(Membership)
            .join(User, User.id == Membership.user_id)
            .where(Membership.group_id == group.id, User.is_active.is_(True))
        )
    return int(await db.scalar(stmt) or 0)
