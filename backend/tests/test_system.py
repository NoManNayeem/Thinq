from httpx import AsyncClient


async def test_liveness(anon: AsyncClient) -> None:
    response = await anon.get("/api/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_reports_database(anon: AsyncClient) -> None:
    response = await anon.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["status"] == "up"
    assert body["database"]["pgvector"] is True
    assert body["database"]["server_version"].startswith("18")
    assert body["database"]["latency_ms"] >= 0


async def test_stream_test_emits_events_in_order(anon: AsyncClient) -> None:
    ticks: list[str] = []
    async with anon.stream("GET", "/api/system/stream-test?count=3&interval_ms=50") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert "no-transform" in response.headers["cache-control"]
        async for line in response.aiter_lines():
            if line.startswith("event: "):
                ticks.append(line.removeprefix("event: "))
    assert ticks == ["tick", "tick", "tick", "done"]


async def test_request_id_header(anon: AsyncClient) -> None:
    response = await anon.get("/api/health/live", headers={"x-request-id": "abc123"})
    assert response.headers["x-request-id"] == "abc123"


async def test_health_degrades_without_leaking_details() -> None:
    from httpx import ASGITransport

    from app.core.config import Settings
    from app.main import create_app

    settings = Settings(
        environment="production",
        database_url="postgresql+psycopg://thinq:thinq@127.0.0.1:1/unreachable",  # type: ignore[arg-type]
        database_connect_timeout_s=1,
        log_level="WARNING",
    )
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client,
    ):
        response = await client.get("/api/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"] == {
        "status": "down",
        "latency_ms": None,
        "server_version": None,
        "pgvector": None,
        "error": "Can't connect to the database.",
    }
