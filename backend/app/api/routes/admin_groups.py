import uuid

from fastapi import APIRouter, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.deps import AdminDep, DbDep, client_ip
from app.models import Group, Membership, User
from app.models.group import EVERYONE_SLUG
from app.schemas.admin import GroupCreateIn, GroupDetailOut, GroupMemberOut, GroupOut, GroupUpdateIn
from app.schemas.common import error_responses
from app.services import groups as group_service
from app.services.users import get_group, member_count

router = APIRouter(prefix="/admin/groups", tags=["admin: groups"])

ERRORS = error_responses(403, 404, 409)


async def _out(db: DbDep, group: Group) -> GroupOut:
    return GroupOut(
        id=group.id,
        slug=group.slug,
        name=group.name,
        description=group.description,
        is_system=group.is_system,
        member_count=await member_count(db, group),
        created_at=group.created_at,
    )


async def _detail(db: DbDep, group: Group) -> GroupDetailOut:
    members: list[GroupMemberOut] = []
    if group.slug == EVERYONE_SLUG:
        users = (
            await db.scalars(
                select(User).where(User.is_active.is_(True)).order_by(func.lower(User.name))
            )
        ).all()
        members = [
            GroupMemberOut(
                id=u.id,
                name=u.name,
                email=u.email,
                title=u.title,
                role="admin" if u.is_admin else "member",
                is_active=u.is_active,
                added_at=None,
                added_by=None,
            )
            for u in users
        ]
    else:
        adder = aliased(User)
        rows = await db.execute(
            select(User, Membership.created_at, adder.name)
            .join(Membership, Membership.user_id == User.id)
            .outerjoin(adder, adder.id == Membership.created_by_id)
            .where(Membership.group_id == group.id)
            .order_by(User.is_active.desc(), func.lower(User.name))
        )
        members = [
            GroupMemberOut(
                id=u.id,
                name=u.name,
                email=u.email,
                title=u.title,
                role="admin" if u.is_admin else "member",
                is_active=u.is_active,
                added_at=added_at,
                added_by=added_by,
            )
            for u, added_at, added_by in rows
        ]
    return GroupDetailOut(**(await _out(db, group)).model_dump(), members=members)


@router.get("", response_model=list[GroupOut], responses=ERRORS)
async def list_groups(_: AdminDep, db: DbDep) -> list[GroupOut]:
    groups = (
        await db.scalars(select(Group).order_by(Group.is_system.desc(), func.lower(Group.name)))
    ).all()
    return [await _out(db, g) for g in groups]


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED, responses=ERRORS)
async def create_group(
    body: GroupCreateIn, admin: AdminDep, db: DbDep, request: Request
) -> GroupOut:
    group = await group_service.create_group(
        db,
        actor=admin.user,
        name=body.name,
        description=body.description,
        ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(group)
    return await _out(db, group)


@router.get("/{group_id}", response_model=GroupDetailOut, responses=ERRORS)
async def get_group_detail(group_id: uuid.UUID, _: AdminDep, db: DbDep) -> GroupDetailOut:
    return await _detail(db, await get_group(db, group_id))


@router.patch("/{group_id}", response_model=GroupDetailOut, responses=ERRORS)
async def update_group(
    group_id: uuid.UUID, body: GroupUpdateIn, admin: AdminDep, db: DbDep, request: Request
) -> GroupDetailOut:
    group = await get_group(db, group_id)
    await group_service.update_group(
        db,
        actor=admin.user,
        group=group,
        name=body.name,
        description=body.description,
        description_set="description" in body.model_fields_set,
        ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(group)
    return await _detail(db, group)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
async def delete_group(group_id: uuid.UUID, admin: AdminDep, db: DbDep, request: Request) -> None:
    group = await get_group(db, group_id)
    await group_service.delete_group(
        db, actor=admin.user, group=group, ip_address=client_ip(request)
    )
    await db.commit()
