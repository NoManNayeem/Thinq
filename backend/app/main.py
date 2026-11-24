import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import __version__
from app.api.middleware import HardeningMiddleware, RequestContextMiddleware
from app.api.routes import (
    admin_audit,
    admin_documents,
    admin_groups,
    admin_knowledge,
    admin_quality,
    admin_users,
    approvals,
    auth,
    chat,
    documents,
    feedback,
    knowledge,
    system,
)
from app.core.config import Settings, get_settings
from app.core.errors import AppError, NotAuthenticated, app_error_handler
from app.core.logging import configure_logging
from app.db.session import create_engine, create_sessionmaker
from app.services.documents.sync import sync_forever
from app.services.knowledge.service import KnowledgeService


def _docs_on(settings: Settings) -> bool:
    if settings.api_docs is not None:
        return settings.api_docs
    return settings.environment != "production"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings)
        app.state.engine = engine
        app.state.sessionmaker = create_sessionmaker(engine)
        app.state.knowledge = None
        sync_task: asyncio.Task[None] | None = None
        if settings.retriever == "cognee":
            service = KnowledgeService.from_settings(settings, app.state.sessionmaker)
            app.state.knowledge = service
            if settings.cognee_sync_interval_s > 0:
                sync_task = asyncio.create_task(service.run_forever(), name="knowledge-sync")
        folder_task: asyncio.Task[None] | None = None
        if settings.sync_interval_s > 0 and settings.seed_dir and settings.environment != "test":
            knowledge = app.state.knowledge
            folder_task = asyncio.create_task(
                sync_forever(
                    app.state.sessionmaker,
                    settings,
                    on_change=knowledge.nudge if knowledge else None,
                ),
                name="document-sync",
            )
        yield
        if folder_task is not None:
            folder_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await folder_task
        if sync_task is not None:
            sync_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sync_task
        if app.state.knowledge is not None:
            await app.state.knowledge.client.aclose()
        await engine.dispose()

    app = FastAPI(
        title="Thinq API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs" if _docs_on(settings) else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if _docs_on(settings) else None,
    )
    app.state.settings = settings
    app.add_middleware(
        HardeningMiddleware,
        max_body_bytes=settings.request_max_bytes,
        requests_per_minute=settings.api_requests_per_minute,
        hsts=settings.cookie_secure,
    )
    app.add_middleware(RequestContextMiddleware)

    async def handle_app_error(request: Request, exc: Exception) -> JSONResponse:
        response = await app_error_handler(request, exc)
        if isinstance(exc, NotAuthenticated) and settings.session_cookie_name in request.cookies:
            response.delete_cookie(settings.session_cookie_name, path="/")
        return response

    app.add_exception_handler(AppError, handle_app_error)

    for module in (
        system,
        auth,
        documents,
        approvals,
        feedback,
        chat,
        knowledge,
        admin_users,
        admin_groups,
        admin_audit,
        admin_documents,
        admin_knowledge,
        admin_quality,
    ):
        app.include_router(module.router, prefix="/api")
    return app


app = create_app()
