"""First-run seeding from ``<seed_dir>/users.csv``.

Runs only while the users table is empty, so a restart never undoes an Admin's changes.

CSV columns: ``name, email, title, role, access_groups`` (``user_id`` is ignored).
``access_groups`` is semicolon-separated; ``Everyone`` is implicit and skipped.
"""

import csv
from dataclasses import dataclass
from pathlib import Path

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models import Group, Membership, Role, User
from app.models.group import EVERYONE_SLUG
from app.services import audit
from app.services.groups import slugify

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class SeedResult:
    users: int
    groups: int
    skipped_reason: str | None = None


def _read_users(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return [
            {k.strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(fh)
        ]


async def seed_from_dir(
    db: AsyncSession, seed_dir: Path | None, password: str | None
) -> SeedResult:
    if seed_dir is None:
        return SeedResult(0, 0, "no seed directory configured")
    users_csv = seed_dir / "users.csv"
    if not users_csv.is_file():
        return SeedResult(0, 0, f"{users_csv} not found")
    if int(await db.scalar(select(func.count()).select_from(User)) or 0) > 0:
        return SeedResult(0, 0, "users already exist")

    rows = _read_users(users_csv)
    groups: dict[str, Group] = {}
    created_groups = 0
    password_hash = hash_password(password) if password else None

    for row in rows:
        names = [g.strip() for g in row.get("access_groups", "").split(";") if g.strip()]
        for name in names:
            slug = slugify(name)
            if slug == EVERYONE_SLUG or slug in groups:
                continue
            group = await db.scalar(select(Group).where(Group.slug == slug))
            if group is None:
                group = Group(slug=slug, name=name)
                db.add(group)
                created_groups += 1
            groups[slug] = group
    await db.flush()

    for row in rows:
        role = row.get("role", "").lower()
        user = User(
            email=row["email"].lower(),
            name=row["name"],
            title=row.get("title") or None,
            role=Role.ADMIN.value if role == Role.ADMIN.value else Role.MEMBER.value,
            is_active=True,
            password_hash=password_hash,
        )
        db.add(user)
        await db.flush()
        for name in row.get("access_groups", "").split(";"):
            slug = slugify(name.strip()) if name.strip() else ""
            if slug and slug != EVERYONE_SLUG:
                db.add(Membership(user_id=user.id, group_id=groups[slug].id))

    await audit.record(
        db,
        actor=None,
        action="system.seeded",
        details={"source": users_csv.name, "users": len(rows), "groups": created_groups},
    )
    await db.flush()
    log.info("seeded", users=len(rows), groups=created_groups)
    return SeedResult(len(rows), created_groups)
