"""Test fixtures. Tests run against a real PostgreSQL database, because access rules are SQL.

Set THINQ_TEST_DATABASE_URL to point elsewhere; the default matches `make db` (compose.dev.yaml).
The database named in the URL is dropped and recreated once per test session.
"""

import os
import shutil
from collections.abc import AsyncIterator, Callable, Coroutine, Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest
from alembic import command
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.security import hash_password
from app.main import create_app
from app.models import Group, Membership, Role, User
from app.prestart import alembic_config
from app.services.documents.importer import scan_documents

TEST_DATABASE_URL = os.environ.get(
    "THINQ_TEST_DATABASE_URL", "postgresql+psycopg://thinq:thinq@localhost:55432/thinq_test"
)
PASSWORD = "correct-horse-battery"
BASE_URL = "http://testserver"


def _recreate_database(url: str) -> None:
    libpq = url.replace("postgresql+psycopg://", "postgresql://", 1)
    base, _, name = libpq.rpartition("/")
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(
        environment="test",
        database_url=TEST_DATABASE_URL,  # type: ignore[arg-type]
        demo_mode=True,
        log_level="WARNING",
        login_max_failures=5,
    )


@pytest.fixture(scope="session")
def migrated(settings: Settings) -> None:
    _recreate_database(settings.database_url_str)
    command.upgrade(alembic_config(settings), "head")


@pytest.fixture(scope="session")
async def app(settings: Settings, migrated: None) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
def maker(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    sessionmaker: async_sessionmaker[AsyncSession] = app.state.sessionmaker
    return sessionmaker


@pytest.fixture(autouse=True)
async def clean_db(app: FastAPI, maker: async_sessionmaker[AsyncSession]) -> AsyncIterator[None]:
    yield
    async with maker() as db:
        await db.execute(
            text(
                "TRUNCATE document_flags, document_versions, document_scans, documents, "
                "audit_events, user_sessions, memberships, users CASCADE"
            )
        )
        await db.execute(text("DELETE FROM groups WHERE NOT is_system"))
        await db.commit()
    if hasattr(app.state, "login_throttle"):
        del app.state.login_throttle


@pytest.fixture
async def db(maker: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with maker() as session:
        yield session


MakeUser = Callable[..., Coroutine[Any, Any, User]]
MakeGroup = Callable[..., Coroutine[Any, Any, Group]]
MakeClient = Callable[..., Coroutine[Any, Any, AsyncClient]]


@pytest.fixture
def make_group(maker: async_sessionmaker[AsyncSession]) -> MakeGroup:
    async def _make(name: str) -> Group:
        async with maker() as db:
            group = Group(name=name, slug=name.lower().replace(" ", "-"))
            db.add(group)
            await db.commit()
            return group

    return _make


@pytest.fixture
def make_user(maker: async_sessionmaker[AsyncSession]) -> MakeUser:
    async def _make(
        name: str,
        *,
        role: str = Role.MEMBER.value,
        groups: list[Group] | None = None,
        active: bool = True,
        password: str | None = PASSWORD,
        title: str | None = None,
    ) -> User:
        async with maker() as db:
            user = User(
                email=f"{name.split()[0].lower()}@example.com",
                name=name,
                title=title,
                role=role,
                is_active=active,
                password_hash=hash_password(password) if password else None,
            )
            db.add(user)
            await db.flush()
            for group in groups or []:
                db.add(Membership(user_id=user.id, group_id=group.id))
            await db.commit()
            return user

    return _make


@pytest.fixture
async def anon(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as client:
        yield client


@pytest.fixture
async def client_for(app: FastAPI) -> AsyncIterator[MakeClient]:
    """Return a signed-in client for a user. Each client has its own cookie jar."""
    clients: list[AsyncClient] = []

    async def _make(user: User, password: str = PASSWORD) -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL)
        clients.append(client)
        response = await client.post(
            "/api/auth/login", json={"email": user.email, "password": password}
        )
        assert response.status_code == 200, response.text
        return client

    yield _make
    for client in clients:
        await client.aclose()


@pytest.fixture
async def org(make_group: MakeGroup, make_user: MakeUser) -> dict[str, Any]:
    """A small organization shaped like the sample data."""
    ops = await make_group("Ops")
    finance = await make_group("Finance")
    nadia = await make_user("Nadia Rahman", groups=[ops], title="Operations Coordinator")
    priya = await make_user("Priya Nair", groups=[finance], title="Finance Manager")
    tariq = await make_user(
        "Tariq Haddad", role=Role.ADMIN.value, groups=[ops, finance], title="Engineering Lead"
    )
    return {"ops": ops, "finance": finance, "nadia": nadia, "priya": priya, "tariq": tariq}


SAMPLE_SEED = Path(__file__).resolve().parents[2] / "seed" / "sample"


@pytest.fixture
def seed_copy(tmp_path: Path, app: FastAPI) -> Iterator[Path]:
    """A writable copy of seed/sample, wired in as the app's seed folder."""
    target = tmp_path / "seed"
    shutil.copytree(SAMPLE_SEED, target)
    settings = app.state.settings
    previous = settings.seed_dir
    settings.seed_dir = target
    yield target
    settings.seed_dir = previous


@pytest.fixture
async def sample_org(make_group: MakeGroup, make_user: MakeUser) -> dict[str, Any]:
    """People and groups matching seed/sample, plus an Admin who isn't in Finance."""
    operations = await make_group("Operations")
    finance = await make_group("Finance")
    dana = await make_user("Dana Lee", groups=[operations])
    sam = await make_user("Sam Patel", groups=[finance])
    alex = await make_user("Alex Morgan", role=Role.ADMIN.value, groups=[operations, finance])
    riley = await make_user("Riley Ops", role=Role.ADMIN.value, groups=[operations])
    return {
        "operations": operations,
        "finance": finance,
        "dana": dana,
        "sam": sam,
        "alex": alex,
        "riley": riley,
    }


@pytest.fixture
def scan(maker: async_sessionmaker[AsyncSession]) -> Callable[[Path], Coroutine[Any, Any, Any]]:
    async def _scan(root: Path) -> Any:
        async with maker() as db, db.begin():
            return await scan_documents(db, root, actor=None)

    return _scan
