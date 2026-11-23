import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.security import hash_session_token, new_session_token
from app.models import User, UserSession

LAST_SEEN_RESOLUTION = timedelta(minutes=1)


def utcnow() -> datetime:
    return datetime.now(UTC)


async def create_session(
    db: AsyncSession,
    user: User,
    *,
    ttl: timedelta,
    ip_address: str | None,
    user_agent: str | None,
) -> tuple[str, UserSession]:
    token = new_session_token()
    session = UserSession(
        token_hash=hash_session_token(token),
        user_id=user.id,
        expires_at=utcnow() + ttl,
        ip_address=ip_address,
        user_agent=(user_agent or "")[:512] or None,
    )
    db.add(session)
    user.last_login_at = utcnow()
    await db.flush()
    return token, session


async def resolve_session(db: AsyncSession, token: str) -> UserSession | None:
    """Return the live session for a token, with its user, or None.

    A session is live when it isn't revoked or expired and its user is active.
    """
    now = utcnow()
    session = await db.scalar(
        select(UserSession)
        .options(joinedload(UserSession.user))
        .join(User, User.id == UserSession.user_id)
        .where(
            UserSession.token_hash == hash_session_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
            User.is_active.is_(True),
        )
    )
    if session is not None and now - session.last_seen_at > LAST_SEEN_RESOLUTION:
        session.last_seen_at = now
    return session


async def revoke_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(
        update(UserSession)
        .where(UserSession.id == session_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


async def revoke_user_sessions(
    db: AsyncSession, user_id: uuid.UUID, *, except_session_id: uuid.UUID | None = None
) -> int:
    stmt = update(UserSession).where(
        UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
    )
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    result = await db.execute(stmt.values(revoked_at=utcnow()))
    return int(getattr(result, "rowcount", 0) or 0)


async def count_active_sessions(db: AsyncSession, user_id: uuid.UUID) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > utcnow(),
        )
    )
    return int(count or 0)
