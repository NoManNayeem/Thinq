"""Pure ASGI middleware, so streamed responses pass through untouched."""

import time
import uuid
from urllib.parse import urlsplit

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = structlog.get_logger("http")

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Process-wide request counters, exposed at /api/metrics.
HTTP_STATS: dict[str, float] = {}


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
            duration = time.perf_counter() - start
            bucket = f"{status // 100}xx"
            HTTP_STATS[f"requests_{bucket}"] = HTTP_STATS.get(f"requests_{bucket}", 0) + 1
            HTTP_STATS["seconds_total"] = HTTP_STATS.get("seconds_total", 0) + duration
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


SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    # The API only serves JSON and event streams; nothing in it should run as a page.
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
]
DOCS_CSP = (
    b"default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    b"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: "
    b"https://fastapi.tiangolo.com; connect-src 'self'; frame-ancestors 'none'"
)


class HardeningMiddleware:
    """Security headers, a request body size limit and a per-client request rate limit."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        max_body_bytes: int,
        requests_per_minute: int,
        hsts: bool,
    ) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.requests_per_minute = requests_per_minute
        self.hsts = hsts
        self._hits: dict[str, list[float]] = {}

    def _limited(self, client: str) -> bool:
        if self.requests_per_minute <= 0:
            return False
        now = time.monotonic()
        window = [t for t in self._hits.get(client, []) if now - t < 60]
        window.append(now)
        self._hits[client] = window
        if len(self._hits) > 10_000:  # bound memory: forget idle clients
            self._hits = {k: v for k, v in self._hits.items() if now - v[-1] < 60}
        return len(window) > self.requests_per_minute

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}
        extra = list(SECURITY_HEADERS)
        if path.startswith("/api/docs"):
            extra = [h for h in extra if h[0] != b"content-security-policy"]
            extra.append((b"content-security-policy", DOCS_CSP))
        if self.hsts:
            extra.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"].extend(extra)
            await send(message)

        if not path.startswith("/api/health"):
            peer = (scope.get("client") or ("unknown", 0))[0]
            forwarded = headers.get("x-forwarded-for") or ""
            # Same rule as deps.client_ip: only a private-network peer may name the client.
            client = (
                forwarded.split(",")[-1].strip() or peer if forwarded and _trusted(peer) else peer
            )
            if self._limited(client):
                await _json_error(
                    send_wrapper,
                    429,
                    "rate_limited",
                    "Too many requests. Slow down a little.",
                    retry=60,
                )
                return
        length = headers.get("content-length")
        if length and length.isdigit() and int(length) > self.max_body_bytes:
            await _json_error(send_wrapper, 413, "too_large", "That request is too large.")
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise BodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send_wrapper)
        except BodyTooLarge:
            await _json_error(send_wrapper, 413, "too_large", "That request is too large.")


class BodyTooLarge(Exception):
    pass


async def _json_error(send: Send, status: int, code: str, message: str, retry: int = 0) -> None:
    import json

    body = json.dumps({"error": {"code": code, "message": message}}).encode()
    headers = [(b"content-type", b"application/json")]
    if retry:
        headers.append((b"retry-after", str(retry).encode()))
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


def _trusted(address: str) -> bool:
    import ipaddress

    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return address in {"testclient", "localhost"}
    return ip.is_private or ip.is_loopback
