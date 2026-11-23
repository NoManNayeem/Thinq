from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_session_token
from app.models import AuditEvent, UserSession
from tests.conftest import PASSWORD, MakeClient, MakeUser


async def test_login_sets_httponly_cookie_and_returns_me(
    anon: AsyncClient, org: dict[str, Any]
) -> None:
    response = await anon.post(
        "/api/auth/login", json={"email": "  NADIA@example.com ", "password": PASSWORD}
    )
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "thinq_session=" in cookie
    assert "HttpOnly" in cookie
    assert "samesite=lax" in cookie.lower()
    body = response.json()
    assert body["user"]["name"] == "Nadia Rahman"
    assert body["user"]["role"] == "member"
    assert [g["name"] for g in body["user"]["groups"]] == ["Everyone", "Ops"]


async def test_me_requires_session(anon: AsyncClient) -> None:
    response = await anon.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


async def test_wrong_password_and_unknown_email_look_the_same(
    anon: AsyncClient, org: dict[str, Any]
) -> None:
    wrong = await anon.post("/api/auth/login", json={"email": "nadia@example.com", "password": "x"})
    unknown = await anon.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "x"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


async def test_inactive_user_cannot_sign_in(anon: AsyncClient, make_user: MakeUser) -> None:
    await make_user("Gone Person", active=False)
    response = await anon.post(
        "/api/auth/login", json={"email": "gone@example.com", "password": PASSWORD}
    )
    assert response.status_code == 401


async def test_repeated_failures_are_throttled(anon: AsyncClient, org: dict[str, Any]) -> None:
    for _ in range(5):
        r = await anon.post("/api/auth/login", json={"email": "nadia@example.com", "password": "x"})
        assert r.status_code == 401
    blocked = await anon.post(
        "/api/auth/login", json={"email": "nadia@example.com", "password": PASSWORD}
    )
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


async def test_failed_login_is_audited(
    anon: AsyncClient, org: dict[str, Any], db: AsyncSession
) -> None:
    await anon.post("/api/auth/login", json={"email": "nadia@example.com", "password": "nope"})
    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "auth.login_failed"))
    assert event is not None
    assert event.target_label == "nadia@example.com"


async def test_only_token_hash_is_stored(
    anon: AsyncClient, org: dict[str, Any], db: AsyncSession
) -> None:
    await anon.post("/api/auth/login", json={"email": "nadia@example.com", "password": PASSWORD})
    token = anon.cookies["thinq_session"]
    stored = (await db.scalars(select(UserSession.token_hash))).all()
    assert token not in stored
    assert hash_session_token(token) in stored


async def test_logout_ends_session(client_for: MakeClient, org: dict[str, Any]) -> None:
    client = await client_for(org["nadia"])
    token = client.cookies["thinq_session"]
    assert (await client.post("/api/auth/logout")).status_code == 204
    client.cookies.set("thinq_session", token)  # replaying the old cookie must not work
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_expired_session_is_rejected_and_cookie_cleared(
    client_for: MakeClient, org: dict[str, Any], db: AsyncSession
) -> None:
    client = await client_for(org["nadia"])
    await db.execute(
        update(UserSession).values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    await db.commit()
    response = await client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "session_expired"
    assert 'thinq_session=""' in response.headers["set-cookie"]


async def test_cross_origin_writes_are_blocked(anon: AsyncClient, org: dict[str, Any]) -> None:
    response = await anon.post(
        "/api/auth/login",
        json={"email": "nadia@example.com", "password": PASSWORD},
        headers={"origin": "https://evil.example"},
    )
    assert response.status_code == 403
    same = await anon.post(
        "/api/auth/login",
        json={"email": "nadia@example.com", "password": PASSWORD},
        headers={"origin": "http://testserver"},
    )
    assert same.status_code == 200


class TestDemoMode:
    async def test_lists_only_active_users(
        self, anon: AsyncClient, org: dict[str, Any], make_user: MakeUser
    ) -> None:
        await make_user("Former Staff", active=False)
        response = await anon.get("/api/auth/demo-users")
        assert response.status_code == 200
        assert [u["name"] for u in response.json()] == [
            "Nadia Rahman",
            "Priya Nair",
            "Tariq Haddad",
        ]

    async def test_demo_login(self, anon: AsyncClient, org: dict[str, Any]) -> None:
        response = await anon.post("/api/auth/demo-login", json={"user_id": str(org["priya"].id)})
        assert response.status_code == 200
        me = await anon.get("/api/auth/me")
        assert me.json()["user"]["email"] == "priya@example.com"

    async def test_disabled_outside_demo_mode(self, anon: AsyncClient, org: dict[str, Any]) -> None:
        settings = anon._transport.app.state.settings  # type: ignore[attr-defined]
        settings.demo_mode = False
        try:
            assert (await anon.get("/api/auth/demo-users")).status_code == 403
            response = await anon.post(
                "/api/auth/demo-login", json={"user_id": str(org["priya"].id)}
            )
            assert response.status_code == 403
            assert (await anon.get("/api/auth/config")).json()["demo_mode"] is False
        finally:
            settings.demo_mode = True


class TestChangePassword:
    async def test_requires_current_password(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        client = await client_for(org["nadia"])
        response = await client.post(
            "/api/auth/me/password",
            json={"current_password": "wrong", "new_password": "a-new-password-1"},
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "wrong_password"

    async def test_rejects_short_password(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        client = await client_for(org["nadia"])
        response = await client.post(
            "/api/auth/me/password", json={"current_password": PASSWORD, "new_password": "short"}
        )
        assert response.status_code == 422

    async def test_signs_out_other_sessions_but_keeps_this_one(
        self, client_for: MakeClient, org: dict[str, Any], anon: AsyncClient
    ) -> None:
        laptop = await client_for(org["nadia"])
        phone = await client_for(org["nadia"])
        response = await laptop.post(
            "/api/auth/me/password",
            json={"current_password": PASSWORD, "new_password": "a-new-password-1"},
        )
        assert response.status_code == 204
        assert (await laptop.get("/api/auth/me")).status_code == 200
        assert (await phone.get("/api/auth/me")).status_code == 401
        relogin = await anon.post(
            "/api/auth/login", json={"email": "nadia@example.com", "password": "a-new-password-1"}
        )
        assert relogin.status_code == 200
