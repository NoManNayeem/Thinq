from datetime import timedelta

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text

from app.api.deps import DbDep, PrincipalDep, SettingsDep, client_ip
from app.api.serializers import group_ref, user_out
from app.core.config import Settings
from app.core.errors import (
    AppError,
    Conflict,
    Forbidden,
    NotAuthenticated,
    NotFound,
    TooManyRequests,
)
from app.core.security import PASSWORD_MIN_LENGTH, hash_password, verify_password
from app.models import Document, Role, User
from app.schemas.auth import (
    AuthConfigOut,
    DemoLoginIn,
    DemoUserOut,
    LoginIn,
    MeOut,
    PasswordChangeIn,
    SessionInfo,
)
from app.schemas.common import Email, ErrorResponse
from app.services import audit
from app.services.access import effective_groups, effective_groups_for
from app.services.sessions import create_session, revoke_session, revoke_user_sessions
from app.services.throttle import LoginThrottle

SETUP_LOCK_KEY = 0x7365747570  # "setup"
router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_CREDENTIALS = "Email or password is incorrect."


def _throttle(request: Request) -> LoginThrottle:
    state = request.app.state
    if not hasattr(state, "login_throttle"):
        settings: Settings = state.settings
        state.login_throttle = LoginThrottle(settings.login_max_failures, settings.login_window_s)
    throttle: LoginThrottle = state.login_throttle
    return throttle


def _set_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


async def _me(db: DbDep, user: User, session_expires_at: object) -> MeOut:
    groups = await effective_groups(db, user)
    owns = await db.scalar(select(Document.id).where(Document.owner_user_id == user.id).limit(1))
    return MeOut(
        user=user_out(user, groups),
        session=SessionInfo.model_validate({"expires_at": session_expires_at}),
        owns_documents=owns is not None,
    )


@router.get("/config", response_model=AuthConfigOut)
async def auth_config(settings: SettingsDep) -> AuthConfigOut:
    return AuthConfigOut(demo_mode=settings.demo_mode, password_min_length=PASSWORD_MIN_LENGTH)


@router.post(
    "/login",
    response_model=MeOut,
    responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
async def login(
    body: LoginIn, request: Request, response: Response, db: DbDep, settings: SettingsDep
) -> MeOut:
    throttle = _throttle(request)
    key = f"{body.email}|{client_ip(request)}"
    # A second, looser limit per account, whatever the address: guessing one account's
    # password from many addresses is throttled too.
    account = f"{body.email}|*"
    if wait := throttle.retry_after(key) or throttle.retry_after(
        account, limit=throttle.max_failures * 4
    ):
        raise TooManyRequests(
            "Too many failed attempts. Try again in a few minutes.", retry_after_s=wait
        )

    user = await db.scalar(select(User).where(User.email == body.email))
    valid, new_hash = verify_password(body.password, user.password_hash if user else None)
    if user is None or not valid or not user.is_active:
        throttle.fail(key)
        throttle.fail(account)
        await audit.record(
            db,
            actor=None,
            action="auth.login_failed",
            target=user,
            target_label=None if user else body.email,
            details={"reason": "inactive" if user and valid else "invalid_credentials"},
            ip_address=client_ip(request),
        )
        await db.commit()
        raise NotAuthenticated(INVALID_CREDENTIALS, code="invalid_credentials")

    throttle.reset(key)
    throttle.reset(account)
    if new_hash:
        user.password_hash = new_hash
    token, session = await create_session(
        db,
        user,
        ttl=timedelta(hours=settings.session_ttl_hours),
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    await audit.record(
        db,
        actor=user,
        action="auth.login",
        details={"method": "password"},
        ip_address=client_ip(request),
    )
    await db.commit()
    _set_cookie(response, settings, token)
    return await _me(db, user, session.expires_at)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    principal: PrincipalDep, request: Request, response: Response, db: DbDep, settings: SettingsDep
) -> None:
    await revoke_session(db, principal.session.id)
    await audit.record(
        db, actor=principal.user, action="auth.logout", ip_address=client_ip(request)
    )
    await db.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")


@router.get("/me", response_model=MeOut, responses={401: {"model": ErrorResponse}})
async def me(principal: PrincipalDep) -> MeOut:
    return MeOut(
        user=user_out(principal.user, principal.groups),
        session=SessionInfo.model_validate(principal.session),
    )


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={400: {"model": ErrorResponse}},
)
async def change_password(
    body: PasswordChangeIn, principal: PrincipalDep, request: Request, db: DbDep
) -> None:
    user = principal.user
    if user.password_hash is not None:
        valid, _ = verify_password(body.current_password or "", user.password_hash)
        if not valid:
            raise AppError("Current password is incorrect.", code="wrong_password")
    user.password_hash = hash_password(body.new_password)
    revoked = await revoke_user_sessions(db, user.id, except_session_id=principal.session.id)
    await audit.record(
        db,
        actor=user,
        action="user.password_changed",
        target=user,
        details={"other_sessions_revoked": revoked},
        ip_address=client_ip(request),
    )
    await db.commit()


@router.get("/demo-users", response_model=list[DemoUserOut])
async def demo_users(db: DbDep, settings: SettingsDep) -> list[DemoUserOut]:
    if not settings.demo_mode:
        raise Forbidden("Demo sign-in is turned off.", code="demo_disabled")
    users = (
        await db.scalars(select(User).where(User.is_active.is_(True)).order_by(User.name))
    ).all()
    groups = await effective_groups_for(db, users)
    return [
        DemoUserOut(
            id=u.id,
            name=u.name,
            title=u.title,
            role="admin" if u.is_admin else "member",
            groups=[group_ref(g) for g in groups[u.id]],
        )
        for u in users
    ]


@router.post(
    "/demo-login",
    response_model=MeOut,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def demo_login(
    body: DemoLoginIn, request: Request, response: Response, db: DbDep, settings: SettingsDep
) -> MeOut:
    if not settings.demo_mode:
        raise Forbidden("Demo sign-in is turned off.", code="demo_disabled")
    user = await db.get(User, body.user_id)
    if user is None or not user.is_active:
        raise NotFound("That user isn't available.")
    token, session = await create_session(
        db,
        user,
        ttl=timedelta(hours=settings.session_ttl_hours),
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    await audit.record(
        db,
        actor=user,
        action="auth.login",
        details={"method": "demo"},
        ip_address=client_ip(request),
    )
    await db.commit()
    _set_cookie(response, settings, token)
    return await _me(db, user, session.expires_at)


class SetupStatusOut(BaseModel):
    needed: bool = Field(description="True only while Thinq has no users at all")


class SetupIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: Email
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=256)


@router.get("/setup", response_model=SetupStatusOut)
async def setup_status(db: DbDep) -> SetupStatusOut:
    return SetupStatusOut(needed=not await db.scalar(select(func.count()).select_from(User)))


@router.post(
    "/setup",
    response_model=MeOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"model": ErrorResponse}},
)
async def first_run_setup(
    body: SetupIn, request: Request, response: Response, db: DbDep, settings: SettingsDep
) -> MeOut:
    """Create the first Admin on an empty installation, then sign them in. Closed for good as
    soon as any user exists (a lock makes two simultaneous attempts safe)."""
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SETUP_LOCK_KEY})
    if await db.scalar(select(func.count()).select_from(User)):
        raise Conflict("Thinq is already set up. Sign in instead.", code="already_set_up")
    user = User(
        email=body.email.lower(),
        name=body.name.strip(),
        role=Role.ADMIN.value,
        is_active=True,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    await db.flush()
    token, session = await create_session(
        db,
        user,
        ttl=timedelta(hours=settings.session_ttl_hours),
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    await audit.record(
        db, actor=user, action="auth.first_admin_created", ip_address=client_ip(request)
    )
    await db.commit()
    _set_cookie(response, settings, token)
    return await _me(db, user, session.expires_at)
