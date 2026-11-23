from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.models import Group, User
from app.services.access import effective_groups
from app.services.seed import seed_from_dir

CSV = """user_id,name,email,title,role,access_groups
U1,Nadia Rahman,Nadia@Example.com,Operations Coordinator,Member,Everyone;Ops
U2,Priya Nair,priya@example.com,Finance Manager,Member,Everyone;Finance
U3,Tariq Haddad,tariq@example.com,Engineering Lead,Admin,Everyone;Ops;Finance
"""


async def test_seeds_users_and_groups(tmp_path: Path, db: AsyncSession) -> None:
    (tmp_path / "users.csv").write_text(CSV)
    result = await seed_from_dir(db, tmp_path, "seed-password-1")
    await db.commit()
    assert (result.users, result.groups) == (3, 2)

    groups = {g.slug: g for g in (await db.scalars(select(Group))).all()}
    assert set(groups) == {"everyone", "ops", "finance"}
    tariq = await db.scalar(select(User).where(User.email == "tariq@example.com"))
    assert tariq is not None and tariq.is_admin
    assert [g.name for g in await effective_groups(db, tariq)] == ["Everyone", "Finance", "Ops"]
    nadia = await db.scalar(select(User).where(User.email == "nadia@example.com"))
    assert nadia is not None and not nadia.is_admin
    assert verify_password("seed-password-1", nadia.password_hash)[0]


async def test_never_reseeds_existing_data(
    tmp_path: Path, db: AsyncSession, org: dict[str, Any]
) -> None:
    (tmp_path / "users.csv").write_text(CSV)
    result = await seed_from_dir(db, tmp_path, None)
    assert result.users == 0
    assert result.skipped_reason == "users already exist"


async def test_missing_folder_is_skipped(tmp_path: Path, db: AsyncSession) -> None:
    result = await seed_from_dir(db, tmp_path / "missing", None)
    assert result.users == 0 and result.skipped_reason


async def test_without_password_users_have_none(tmp_path: Path, db: AsyncSession) -> None:
    (tmp_path / "users.csv").write_text(CSV)
    await seed_from_dir(db, tmp_path, None)
    await db.commit()
    hashes = (await db.scalars(select(User.password_hash))).all()
    assert hashes == [None, None, None]
