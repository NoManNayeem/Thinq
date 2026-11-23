"""A small client for the Cognee REST API (the ``cognee`` compose service).

Cognee runs as its own service, so its dependencies never mix with Thinq's. Thinq signs in as one
service account and keeps one dataset per access group. Cognee's own access control stays on as
defence in depth, but Thinq never relies on it: every hit is re-checked against Thinq's rules.
"""

import json
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)


class CogneeError(Exception):
    pass


@dataclass(frozen=True)
class ChunkHit:
    text: str
    cognee_data_id: uuid.UUID | None
    thinq_document_id: uuid.UUID | None
    score: float  # vector distance: lower is closer
    rank: int


def _uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except ValueError, TypeError:
        return None


def _metadata(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def parse_chunk_hits(payload: object) -> list[ChunkHit]:
    """Flatten a ``CHUNKS`` search response (one entry per dataset) into ranked hits."""
    rows: list[dict[str, Any]] = []
    if isinstance(payload, list):
        for entry in payload:
            if isinstance(entry, dict) and isinstance(entry.get("search_result"), list):
                rows.extend(r for r in entry["search_result"] if isinstance(r, dict))
            elif isinstance(entry, dict) and "text" in entry:
                rows.append(entry)
    rows.sort(key=lambda r: float(r.get("score") or 0.0))
    hits = []
    for rank, row in enumerate(rows, start=1):
        meta = _metadata(row.get("external_metadata"))
        hits.append(
            ChunkHit(
                text=str(row.get("text") or ""),
                cognee_data_id=_uuid(row.get("document_id")),
                thinq_document_id=_uuid(meta.get("thinq_document_id")),
                score=float(row.get("score") or 0.0),
                rank=rank,
            )
        )
    return hits


class CogneeClient:
    def __init__(
        self,
        base_url: str,
        *,
        username: str,
        password: str | None,
        timeout_s: float = 20,
        index_timeout_s: float = 900,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._username = username
        self._password = password or ""
        self._index_timeout_s = index_timeout_s
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), timeout=timeout_s, transport=transport
        )
        self._token: str | None = None

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _login(self) -> str:
        try:
            response = await self._http.post(
                "/api/v1/auth/login",
                data={"username": self._username, "password": self._password},
            )
        except httpx.HTTPError as exc:
            raise CogneeError(f"Cognee is unreachable: {exc.__class__.__name__}") from exc
        if response.status_code != 200:
            raise CogneeError(f"Cognee sign-in failed ({response.status_code}).")
        token = response.json().get("access_token")
        if not isinstance(token, str):
            raise CogneeError("Cognee sign-in returned no token.")
        self._token = token
        return token

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        for attempt in (1, 2):
            token = self._token or await self._login()
            try:
                response = await self._http.request(
                    method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs
                )
            except httpx.HTTPError as exc:
                raise CogneeError(f"Cognee is unreachable: {exc.__class__.__name__}") from exc
            if response.status_code == 401 and attempt == 1:
                self._token = None  # tokens don't survive a Cognee restart; sign in again
                continue
            if response.status_code >= 400:
                raise CogneeError(
                    f"Cognee {method} {path} failed ({response.status_code}): {response.text[:300]}"
                )
            return response.json() if response.content else None
        raise CogneeError("Cognee rejected the service account.")

    async def health(self) -> bool:
        try:
            response = await self._http.get("/health")
        except httpx.HTTPError:
            return False
        return response.status_code == 200

    async def ensure_dataset(self, name: str) -> uuid.UUID:
        body = await self._request("POST", "/api/v1/datasets", json={"name": name})
        dataset_id = _uuid(body.get("id") if isinstance(body, dict) else None)
        if dataset_id is None:
            raise CogneeError("Cognee returned no dataset id.")
        return dataset_id

    async def add_document(
        self, dataset_id: uuid.UUID, *, filename: str, text: str, metadata: dict[str, str]
    ) -> uuid.UUID:
        body = await self._request(
            "POST",
            "/api/v1/add",
            files={"data": (filename, text.encode(), "text/markdown")},
            data={
                "datasetId": str(dataset_id),
                "external_metadata": json.dumps([metadata]),
                "labels": json.dumps([filename]),
            },
            timeout=self._index_timeout_s,
        )
        ids = body.get("data_ids") if isinstance(body, dict) else None
        data_id = _uuid(ids[0]) if isinstance(ids, list) and ids else None
        if data_id is None:
            raise CogneeError("Cognee returned no data id.")
        return data_id

    async def delete_document(self, dataset_id: uuid.UUID, data_id: uuid.UUID) -> None:
        await self._request("DELETE", f"/api/v1/datasets/{dataset_id}/data/{data_id}")

    async def cognify(self, dataset_ids: list[uuid.UUID]) -> None:
        """Build the graph and chunk embeddings. Blocking; runs in the background sync."""
        await self._request(
            "POST",
            "/api/v1/cognify",
            json={"dataset_ids": [str(d) for d in dataset_ids], "run_in_background": False},
            timeout=self._index_timeout_s,
        )

    async def search_chunks(
        self, query: str, dataset_ids: list[uuid.UUID], *, top_k: int = 12
    ) -> list[ChunkHit]:
        if not dataset_ids:
            return []
        body = await self._request(
            "POST",
            "/api/v1/search",
            json={
                "search_type": "CHUNKS",
                "query": query,
                "dataset_ids": [str(d) for d in dataset_ids],
                "top_k": top_k,
            },
        )
        return parse_chunk_hits(body)

    async def dataset_graph(self, dataset_id: uuid.UUID) -> dict[str, Any]:
        body = await self._request("GET", f"/api/v1/datasets/{dataset_id}/graph")
        if not isinstance(body, dict):
            return {"nodes": [], "edges": []}
        return {
            "nodes": [n for n in body.get("nodes") or [] if isinstance(n, dict)],
            "edges": [e for e in body.get("edges") or [] if isinstance(e, dict)],
        }
