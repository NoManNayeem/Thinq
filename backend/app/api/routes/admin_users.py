import uuid
from typing import Literal

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, or_, select

from app.api.deps import AdminDep, DbDep, client_ip
from app.api.serializers import user_out
from app.models import Group, Membership, User
from app.models.group import EVERYONE_SLUG
from app.schemas.admin import (
    PasswordSetIn,
    UserCreateIn,
    UserDetailOut,
    UserListOut,
    UserUpdateIn,
)
from app.schemas.common import UserOut, error_responses
from app.services import audit
from app.services import users as user_service
from app.services.access import effective_groups, effective_groups_for
from app.services.sessions import count_active_sessions, revoke_user_sessions

router = APIRouter(prefix="/admin/users", tags=["admin: users"])

ERRORS = error_responses(403, 404, 409)


async def _detail(db: DbDep, user: User) -> UserDetailOut:
    groups = await effective_groups(db, user)
    return UserDetailOut(
        **user_out(user, groups).model_dump(),
        active_session_count=await count_active_sessions(db, user.id),
    )


@router.get("", response_model=UserListOut, responses=ERRORS)
async def list_users(
    _: AdminDep,
    db: DbDep,
    q: str | None = Query(default=None, max_length=200),
    role: Literal["member", "admin"] | None = None,
    group_id: uuid.UUID | None = None,
    status_filter: Literal["active", "inactive", "all"] = Query(default="all", alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> UserListOut:
    stmt = select(User)
    if q:
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.name).like(pattern),
                User.email.like(pattern),
                func.lower(func.coalesce(User.title, "")).like(pattern),
            )
        )
    if role:
        stmt = stmt.where(User.role == role)
    if status_filter != "all":
        stmt = stmt.where(User.is_active.is_(status_filter == "active"))
    if group_id:
        group = await user_service.get_group(db, group_id)
        if group.slug == EVERYONE_SLUG:
            stmt = stmt.where(User.is_active.is_(True))
        else:
            stmt = stmt.where(
                User.id.in_(select(Membership.user_id).where(Membership.group_id == group_id))
            )
    total = int(await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    users = (
        await db.scalars(
            stmt.order_by(User.is_active.desc(), func.lower(User.name)).limit(limit).offset(offset)
        )
    ).all()
    groups = await effective_groups_for(db, users)
    return UserListOut(items=[user_out(u, groups[u.id]) for u in users], total=total)


@router.post(
    "", response_model=UserDetailOut, status_code=status.HTTP_201_CREATED, responses=ERRORS
)
async def create_user(
    body: UserCreateIn, admin: AdminDep, db: DbDep, request: Request
) -> UserDetailOut:
    user = await user_service.create_user(
        db,
        actor=admin.user,
        email=body.email,
        name=body.name,
        title=body.title,
        role=body.role,
        password=body.password,
        group_ids=body.group_ids,
        ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(user)
    return await _detail(db, user)


@router.get("/{user_id}", response_model=UserDetailOut, responses=ERRORS)
async def get_user(user_id: uuid.UUID, _: AdminDep, db: DbDep) -> UserDetailOut:
    return await _detail(db, await user_service.get_user(db, user_id))


@router.patch("/{user_id}", response_model=UserDetailOut, responses=ERRORS)
async def update_user(
    user_id: uuid.UUID, body: UserUpdateIn, admin: AdminDep, db: DbDep, request: Request
) -> UserDetailOut:
    user = await user_service.get_user(db, user_id)
    await user_service.update_user(
        db,
        actor=admin.user,
        user=user,
        name=body.name,
        title=body.title,
        title_set="title" in body.model_fields_set,
        role=body.role,
        is_active=body.is_active,
        ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(user)
    return await _detail(db, user)


@router.put("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
async def set_password(
    user_id: uuid.UUID, body: PasswordSetIn, admin: AdminDep, db: DbDep, request: Request
) -> None:
    user = await user_service.get_user(db, user_id)
    await user_service.set_password(
        db,
        actor=admin.user,
        user=user,
        new_password=body.new_password,
        ip_address=client_ip(request),
    )
    await db.commit()


@router.post("/{user_id}/sessions/revoke", response_model=UserDetailOut, responses=ERRORS)
async def revoke_sessions(
    user_id: uuid.UUID, admin: AdminDep, db: DbDep, request: Request
) -> UserDetailOut:
    user = await user_service.get_user(db, user_id)
    except_id = admin.session.id if user.id == admin.user.id else None
    revoked = await revoke_user_sessions(db, user.id, except_session_id=except_id)
    await audit.record(
        db,
        actor=admin.user,
        action="user.sessions_revoked",
        target=user,
        details={"sessions_revoked": revoked},
        ip_address=client_ip(request),
    )
    await db.commit()
    return await _detail(db, user)


@router.put("/{user_id}/groups/{group_id}", response_model=UserOut, responses=ERRORS)
async def add_to_group(
    user_id: uuid.UUID, group_id: uuid.UUID, admin: AdminDep, db: DbDep, request: Request
) -> UserOut:
    user = await user_service.get_user(db, user_id)
    group: Group = await user_service.get_group(db, group_id)
    await user_service.add_membership(
        db, actor=admin.user, user=user, group=group, ip_address=client_ip(request)
    )
    await db.commit()
    return user_out(user, await effective_groups(db, user))


@router.delete("/{user_id}/groups/{group_id}", response_model=UserOut, responses=ERRORS)
async def remove_from_group(
    user_id: uuid.UUID, group_id: uuid.UUID, admin: AdminDep, db: DbDep, request: Request
) -> UserOut:
    user = await user_service.get_user(db, user_id)
    group = await user_service.get_group(db, group_id)
    await user_service.remove_membership(
        db, actor=admin.user, user=user, group=group, ip_address=client_ip(request)
    )
    await db.commit()
    return user_out(user, await effective_groups(db, user))
