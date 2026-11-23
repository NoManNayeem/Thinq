"""Encode a reply in the AI SDK UI message stream protocol.

SSE with the header `x-vercel-ai-ui-message-stream: v1`.

Keeping to a published protocol lets the web app use a standard chat client, while the
backend stays free to use any model provider.
"""

import json
from typing import Any

HEADERS = {
    "x-vercel-ai-ui-message-stream": "v1",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}


def event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, default=str, ensure_ascii=False)}\n\n"


def done() -> str:
    return "data: [DONE]\n\n"
