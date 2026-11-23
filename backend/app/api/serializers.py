from app.models import Group, User
from app.schemas.common import GroupRef, UserOut


def group_ref(group: Group) -> GroupRef:
    return GroupRef(id=group.id, slug=group.slug, name=group.name, is_system=group.is_system)


def user_out(user: User, groups: list[Group]) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        title=user.title,
        role="admin" if user.is_admin else "member",
        is_active=user.is_active,
        has_password=user.password_hash is not None,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        groups=[group_ref(g) for g in groups],
    )
