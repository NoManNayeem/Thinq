import asyncio
import hmac
import json
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import func, select, text

from app import __version__
from app.api.deps import AdminDep, DbDep
from app.api.middleware import HTTP_STATS
from app.core.config import Settings
from app.core.errors import NotFound
from app.models import ChatMessage, Document, FeedbackItem
from app.schemas.common import error_responses
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


# ---------------------------------------------------------------- operations


def config_warnings(settings: Settings) -> list[str]:
    """Settings that are fine for a demo but unsafe for real use."""
    warnings = []
    production = settings.environment == "production"
    if settings.demo_mode:
        warnings.append(
            "Demo mode is on: anyone can sign in as any user. Turn off THINQ_DEMO_MODE."
        )
    if production and not settings.cookie_secure:
        warnings.append(
            "Session cookies aren't marked Secure. Serve over HTTPS and set "
            "THINQ_COOKIE_SECURE=true."
        )
    if ":thinq@" in settings.database_url_str:
        warnings.append("The database uses the default password. Change POSTGRES_PASSWORD.")
    if settings.retriever == "cognee" and settings.cognee_password in (None, "", "thinq-cognee"):
        warnings.append("Cognee uses the default service password. Change COGNEE_PASSWORD.")
    if settings.seed_password:
        warnings.append(
            "THINQ_SEED_PASSWORD is set: seeded users share one password until they change it."
        )
    return warnings


@router.get("/admin/config-warnings", response_model=list[str], responses=error_responses(401, 403))
async def admin_config_warnings(_: AdminDep, request: Request) -> list[str]:
    return config_warnings(request.app.state.settings)


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request, db: DbDep) -> PlainTextResponse:
    """Prometheus metrics. Disabled unless THINQ_METRICS_TOKEN is set; send it as a Bearer token."""
    settings = request.app.state.settings
    expected = settings.metrics_token
    given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not expected or not hmac.compare_digest(given, expected):
        raise NotFound("Not found.")
    lines: list[str] = []

    def metric(name: str, kind: str, help_text: str, samples: list[tuple[str, float]]) -> None:
        lines.append(f"# HELP {name} {help_text}")
        lines.append(f"# TYPE {name} {kind}")
        lines.extend(f"{name}{labels} {value}" for labels, value in samples)

    metric(
        "thinq_http_requests_total",
        "counter",
        "HTTP requests by status class.",
        [(f'{{class="{k[9:]}"}}', v) for k, v in HTTP_STATS.items() if k.startswith("requests_")],
    )
    metric(
        "thinq_http_request_seconds_total",
        "counter",
        "Time spent serving requests.",
        [("", round(HTTP_STATS.get("seconds_total", 0.0), 3))],
    )
    rows: list[tuple[str | None, int, int, int, float]] = [
        (e, int(n), int(i or 0), int(o or 0), float(c or 0))
        for e, n, i, o, c in (
            await db.execute(
                select(
                    ChatMessage.engine,
                    func.count(),
                    func.coalesce(func.sum(ChatMessage.input_tokens), 0),
                    func.coalesce(func.sum(ChatMessage.output_tokens), 0),
                    func.coalesce(func.sum(ChatMessage.cost_usd), 0.0),
                )
                .where(ChatMessage.role == "assistant")
                .group_by(ChatMessage.engine)
            )
        ).all()
    ]
    metric(
        "thinq_answers_total",
        "counter",
        "Answers given, by engine.",
        [(f'{{engine="{e or "none"}"}}', n) for e, n, *_ in rows],
    )
    metric(
        "thinq_llm_tokens_total",
        "counter",
        "Model tokens used.",
        [
            ('{direction="input"}', sum(r[2] for r in rows)),
            ('{direction="output"}', sum(r[3] for r in rows)),
        ],
    )
    metric(
        "thinq_llm_cost_usd_total",
        "counter",
        "Estimated model cost in US dollars.",
        [("", round(sum(r[4] for r in rows), 6))],
    )
    open_items = await db.scalar(
        select(func.count()).select_from(FeedbackItem).where(FeedbackItem.state == "open")
    )
    metric("thinq_feedback_open", "gauge", "Open feedback items.", [("", float(open_items or 0))])
    docs = (await db.execute(select(Document.status, func.count()).group_by(Document.status))).all()
    metric(
        "thinq_documents",
        "gauge",
        "Documents by status.",
        [(f'{{status="{s}"}}', n) for s, n in docs],
    )
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
