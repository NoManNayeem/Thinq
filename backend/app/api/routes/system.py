import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from app import __version__
from app.schemas.system import DatabaseHealth, HealthOut

router = APIRouter(tags=["system"])
log = structlog.get_logger(__name__)

HEALTH_QUERY_TIMEOUT_S = 3


@router.get("/health/live", summary="Liveness: the process is up")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get(
    "/health",
    response_model=HealthOut,
    summary="Readiness: the API can reach its database",
    responses={503: {"model": HealthOut}},
)
async def health(request: Request, response: Response) -> HealthOut:
    settings = request.app.state.settings
    db = DatabaseHealth(status="down")
    try:
        async with asyncio.timeout(HEALTH_QUERY_TIMEOUT_S):
            async with request.app.state.engine.connect() as conn:
                start = time.perf_counter()
                await conn.execute(text("SELECT 1"))
                latency = (time.perf_counter() - start) * 1000
                version = await conn.scalar(text("SHOW server_version"))
                has_vector = await conn.scalar(
                    text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
                )
        db = DatabaseHealth(
            status="up",
            latency_ms=round(latency, 2),
            server_version=str(version).split(" ")[0],
            pgvector=bool(has_vector),
        )
    except Exception as exc:  # health must report, never raise
        log.warning("database health check failed", error=str(exc).splitlines()[0][:300])
        # This endpoint is public: only development builds expose driver details.
        db.error = (
            str(exc).splitlines()[0][:200]
            if settings.environment == "development"
            else "Can't connect to the database."
        )
    status = "ok" if db.status == "up" else "degraded"
    if status != "ok":
        response.status_code = 503
    return HealthOut(
        status=status, version=__version__, environment=settings.environment, database=db
    )


@router.get(
    "/system/stream-test",
    summary="Emit a few Server-Sent Events, to verify streaming end to end",
    response_class=StreamingResponse,
)
async def stream_test(
    count: int = Query(default=5, ge=1, le=20),
    interval_ms: int = Query(default=250, ge=50, le=2000),
) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        for n in range(1, count + 1):
            payload = {"n": n, "of": count, "at": datetime.now(UTC).isoformat()}
            yield f"event: tick\ndata: {json.dumps(payload)}\n\n"
            await asyncio.sleep(interval_ms / 1000)
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
