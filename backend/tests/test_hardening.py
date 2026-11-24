"""Hardening: security headers, size and rate limits, first-run setup, config warnings, metrics."""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.routes.system import config_warnings
from app.core.config import Settings
from app.main import create_app
from tests.conftest import BASE_URL, MakeClient


@pytest.fixture
async def strict_app(settings: Settings, migrated: None) -> AsyncIterator[FastAPI]:
    strict = settings.model_copy(
        update={
            "api_requests_per_minute": 5,
            "chat_questions_per_minute": 1,
            "request_max_bytes": 2000,
            "metrics_token": "metrics-secret",
        }
    )
    application = create_app(strict)
    async with application.router.lifespan_context(application):
        yield application


async def test_security_headers(anon: AsyncClient) -> None:
    r = await anon.get("/api/health/live")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert "strict-transport-security" not in r.headers  # only behind HTTPS


async def test_request_size_and_rate_limits(strict_app: FastAPI) -> None:
    async with AsyncClient(transport=ASGITransport(app=strict_app), base_url=BASE_URL) as c:
        r = await c.post(
            "/api/auth/login", content=b"x" * 5000, headers={"content-type": "application/json"}
        )
        assert r.status_code == 413
        codes = [(await c.get("/api/auth/config")).status_code for _ in range(6)]
        assert codes[-1] == 429 and "retry-after" in (await c.get("/api/auth/config")).headers
        # Health checks are never rate limited.
        assert (await c.get("/api/health/live")).status_code == 200


async def test_first_run_setup_only_works_on_an_empty_install(
    anon: AsyncClient, make_user: Any
) -> None:
    assert (await anon.get("/api/auth/setup")).json() == {"needed": True}
    body = {"name": "First Admin", "email": "first@example.com", "password": "a-long-password-1"}
    r = await anon.post("/api/auth/setup", json=body)
    assert r.status_code == 201 and r.json()["user"]["role"] == "admin"
    assert (await anon.get("/api/auth/me")).status_code == 200  # signed in
    assert (await anon.get("/api/auth/setup")).json() == {"needed": False}
    again = await anon.post("/api/auth/setup", json={**body, "email": "second@example.com"})
    assert again.status_code == 409


def test_config_warnings_flag_unsafe_defaults(settings: Settings) -> None:
    risky = settings.model_copy(
        update={"demo_mode": True, "environment": "production", "cookie_secure": False}
    )
    text = " ".join(config_warnings(risky))
    assert "Demo mode is on" in text and "THINQ_COOKIE_SECURE" in text


async def test_metrics_need_the_token(strict_app: FastAPI) -> None:
    async with AsyncClient(transport=ASGITransport(app=strict_app), base_url=BASE_URL) as c:
        assert (await c.get("/api/metrics")).status_code == 404
        r = await c.get("/api/metrics", headers={"authorization": "Bearer metrics-secret"})
        assert r.status_code == 200 and "thinq_http_requests_total" in r.text


async def test_questions_are_rate_limited_per_person(strict_app: FastAPI, make_user: Any) -> None:
    from tests.conftest import PASSWORD

    user = await make_user("Quick Asker")
    async with AsyncClient(transport=ASGITransport(app=strict_app), base_url=BASE_URL) as c:
        await c.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
        chat = (await c.post("/api/chat/conversations", json={})).json()["id"]
        url = f"/api/chat/conversations/{chat}/messages"
        first = await c.post(url, json={"text": "hello", "trigger": "submit-message"})
        assert first.status_code == 200
        second = await c.post(url, json={"text": "hello again", "trigger": "submit-message"})
        assert second.status_code == 429


async def test_admin_sees_config_warnings(client_for: MakeClient, make_user: Any) -> None:
    admin = await make_user("Ada Admin", role="admin")
    client = await client_for(admin)
    r = await client.get("/api/admin/config-warnings")
    assert r.status_code == 200 and isinstance(r.json(), list)
