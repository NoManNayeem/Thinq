import ipaddress
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import Forbidden, NotAuthenticated
from app.models import Group, User, UserSession
from app.services.access import effective_groups
from app.services.sessions import resolve_session


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
DbDep = Annotated[AsyncSession, Depends(get_db)]


@dataclass(frozen=True)
class Principal:
    """The signed-in user, as of this request. Rebuilt from the database on every request."""

    user: User
    session: UserSession
    groups: list[Group]

    @property
    def group_slugs(self) -> frozenset[str]:
        return frozenset(g.slug for g in self.groups)


async def get_principal(request: Request, db: DbDep, settings: SettingsDep) -> Principal:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise NotAuthenticated("Sign in to continue.")
    session = await resolve_session(db, token)
    if session is None:
        raise NotAuthenticated("Your session has ended. Sign in again.", code="session_expired")
    groups = await effective_groups(db, session.user)
    if db.dirty:
        await db.commit()
    return Principal(user=session.user, session=session, groups=groups)


PrincipalDep = Annotated[Principal, Depends(get_principal)]


async def require_admin(principal: PrincipalDep) -> Principal:
    if not principal.user.is_admin:
        raise Forbidden("Only Admins can do this.")
    return principal


AdminDep = Annotated[Principal, Depends(require_admin)]


def client_ip(request: Request) -> str | None:
    """The browser's address. ``X-Forwarded-For`` is only believed when the request comes from a
    private-network peer (the web container or a reverse proxy in front of it); its last entry is
    the one that peer added."""
    peer = request.client.host if request.client else None
    forwarded = request.headers.get("x-forwarded-for")
    if peer and forwarded and is_trusted_proxy(peer):
        last = forwarded.split(",")[-1].strip()
        return last or peer
    return peer


def is_trusted_proxy(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return address in {"testclient", "localhost"}
    return ip.is_private or ip.is_loopback
