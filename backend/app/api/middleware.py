"""Pure ASGI middleware, so streamed responses pass through untouched."""

import time
import uuid
from urllib.parse import urlsplit

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = structlog.get_logger("http")

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class RequestContextMiddleware:
    """Request IDs, access logging, and a same-origin check for state-changing requests.

    The session cookie is SameSite=Lax, which already stops cross-site form posts.
    The Origin check is a second layer: a browser always sends Origin on unsafe
    requests, and it must match the host the request was addressed to.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}
        request_id = headers.get("x-request-id") or uuid.uuid4().hex
        method = scope["method"]
        path = scope["path"]
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        status = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", [])
                message["headers"].append((b"x-request-id", request_id.encode()))
            await send(message)

        try:
            origin = headers.get("origin")
            if method in UNSAFE_METHODS and origin:
                expected = headers.get("x-forwarded-host") or headers.get("host", "")
                if urlsplit(origin).netloc != expected:
                    status = 403
                    await _forbidden_origin(send_wrapper)
                    return
            await self.app(scope, receive, send_wrapper)
        finally:
            if not path.startswith("/api/health"):
                log.info(
                    "request",
                    method=method,
                    path=path,
                    status=status,
                    duration_ms=round((time.perf_counter() - start) * 1000, 1),
                )
            structlog.contextvars.unbind_contextvars("request_id")


async def _forbidden_origin(send: Send) -> None:
    body = b'{"error":{"code":"bad_origin","message":"Cross-origin request blocked."}}'
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})
