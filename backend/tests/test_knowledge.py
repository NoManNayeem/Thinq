"""Knowledge layer (Cognee) and knowledge graph: Thinq stays the only judge of access.

The fake Cognee below misbehaves on purpose: search and graph return results from *every*
dataset, whatever was asked for. The tests prove Thinq still only ever uses documents the
person can see right now.
"""

import json
import re
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Document, KnowledgeItem, Membership
from app.services.documents.trust import family_key
from app.services.knowledge.cognee_client import CogneeClient, parse_chunk_hits
from app.services.knowledge.service import KnowledgeService
from tests.conftest import MakeClient
from tests.test_chat import ask, new_chat


class FakeCognee:
    def __init__(self) -> None:
        self.datasets: dict[str, uuid.UUID] = {}
        self.data: dict[uuid.UUID, dict[str, Any]] = {}  # data_id -> {dataset, text, meta}
        self.cognified: list[list[str]] = []
        self.deleted: list[uuid.UUID] = []
        self.logins = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/api/v1/auth/login":
            self.logins += 1
            return httpx.Response(200, json={"access_token": "t"})
        if request.headers.get("authorization") != "Bearer t":
            return httpx.Response(401)
        if path == "/api/v1/datasets" and request.method == "POST":
            name = json.loads(request.content)["name"]
            dataset_id = self.datasets.setdefault(name, uuid.uuid4())
            return httpx.Response(200, json={"id": str(dataset_id), "name": name})
        if path == "/api/v1/add":
            body = request.content.decode(errors="replace")
            dataset = re.search(r'name="datasetId"\r\n\r\n([0-9a-f-]+)', body)
            meta = re.search(r'name="external_metadata"\r\n\r\n(\[.*?\])\r\n', body)
            text = body.split("Content-Type: text/markdown\r\n\r\n", 1)[1].split("\r\n--", 1)[0]
            assert dataset and meta
            data_id = uuid.uuid4()
            self.data[data_id] = {
                "dataset": uuid.UUID(dataset.group(1)),
                "text": text,
                "meta": json.loads(meta.group(1))[0],
            }
            return httpx.Response(200, json={"data_ids": [str(data_id)]})
        if path.startswith("/api/v1/datasets/") and request.method == "DELETE":
            data_id = uuid.UUID(path.rsplit("/", 1)[1])
            self.deleted.append(data_id)
            self.data.pop(data_id, None)
            return httpx.Response(200, json={"status": "deleted"})
        if path == "/api/v1/cognify":
            self.cognified.append(json.loads(request.content)["dataset_ids"])
            return httpx.Response(200, json={})
        if path == "/api/v1/search":
            query = set(json.loads(request.content)["query"].lower().split())
            rows = []
            for data_id, item in self.data.items():  # every dataset: deliberately wrong
                words = set(item["text"].lower().split())
                overlap = len(query & words) / max(len(query), 1)
                rows.append(
                    {
                        "text": item["text"],
                        "document_id": str(data_id),
                        "external_metadata": json.dumps(item["meta"]),
                        "score": round(1 - overlap, 3),
                    }
                )
            return httpx.Response(200, json=[{"dataset_id": "x", "search_result": rows}])
        if path.endswith("/graph"):
            nodes, edges = [], []
            for data_id, item in self.data.items():  # every dataset: deliberately wrong
                chunk = f"chunk-{data_id}"
                entity = f"entity-{data_id}"
                nodes += [
                    {
                        "id": chunk,
                        "type": "DocumentChunk",
                        "properties": {"document_id": str(data_id)},
                    },
                    {
                        "id": entity,
                        "type": "Entity",
                        "label": item["text"].splitlines()[0].lstrip("# ") + " topic",
                        "properties": {"description": "from " + item["meta"]["thinq_document_id"]},
                    },
                    {"id": "type-topic", "type": "EntityType", "label": "topic"},
                ]
                edges += [
                    {"source": chunk, "target": entity, "label": "contains"},
                    {"source": entity, "target": "type-topic", "label": "is_a"},
                ]
            return httpx.Response(200, json={"nodes": nodes, "edges": edges})
        return httpx.Response(404, json={"detail": path})


@pytest.fixture
async def cognee(
    app: FastAPI, maker: async_sessionmaker[AsyncSession]
) -> AsyncIterator[tuple[FakeCognee, KnowledgeService]]:
    fake = FakeCognee()
    client = CogneeClient(
        "http://cognee", username="u", password="p", transport=httpx.MockTransport(fake.handler)
    )
    service = KnowledgeService(settings=app.state.settings, sessionmaker=maker, client=client)
    app.state.knowledge = service
    yield fake, service
    app.state.knowledge = None
    await client.aclose()


@pytest.fixture
async def ready(seed_copy: Path, sample_org: dict[str, Any], scan: Any) -> dict[str, Any]:
    await scan(seed_copy)
    return sample_org


def test_parse_chunk_hits_orders_by_distance() -> None:
    hits = parse_chunk_hits(
        [
            {
                "search_result": [
                    {"text": "b", "document_id": str(uuid.uuid4()), "score": 0.4},
                    {
                        "text": "a",
                        "document_id": "not-a-uuid",
                        "external_metadata": "{bad json",
                        "score": 0.1,
                    },
                ]
            }
        ]
    )
    assert [h.text for h in hits] == ["a", "b"]
    assert hits[0].cognee_data_id is None and hits[0].thinq_document_id is None
    assert [h.rank for h in hits] == [1, 2]


def test_family_key_groups_versions() -> None:
    assert family_key("Travel Policy v3") == family_key("Travel Policy") == "travel policy"
    assert family_key("Vendor Onboarding Form FINAL v2") == "vendor onboarding form"
    assert family_key("Operations Weekly Nov 2 2026") == "operations weekly"


async def test_sync_indexes_one_dataset_per_group(
    ready: dict[str, Any], cognee: tuple[FakeCognee, KnowledgeService], db: AsyncSession
) -> None:
    fake, service = cognee
    assert await service.sync_once() is True
    docs = (await db.scalars(select(Document).where(Document.is_registered.is_(True)))).all()
    items = {i.document_id: i for i in (await db.scalars(select(KnowledgeItem))).all()}
    for doc in docs:
        if doc.status == "outdated":
            assert doc.id not in items  # never indexed
        else:
            assert items[doc.id].status == "indexed"
            assert items[doc.id].scope_id == doc.access_group_id
    # Datasets are walls: a dataset only holds documents of one access group.
    by_dataset: dict[uuid.UUID, set[Any]] = {}
    for item in items.values():
        by_dataset.setdefault(item.cognee_dataset_id, set()).add(item.scope_id)
    assert all(len(scopes) == 1 for scopes in by_dataset.values())
    # Lines aimed at an AI assistant are never sent for indexing.
    assert not any(
        "ignore" in d["text"].lower() and "instruction" in d["text"].lower()
        for d in fake.data.values()
    )
    # Nothing to do on the next pass.
    assert await service.sync_once() is False


async def test_sync_follows_edits_and_group_moves(
    ready: dict[str, Any], cognee: tuple[FakeCognee, KnowledgeService], db: AsyncSession
) -> None:
    fake, service = cognee
    await service.sync_once()
    payroll = await db.scalar(select(Document).where(Document.title == "Payroll Calendar 2027"))
    assert payroll is not None
    before = await db.get(KnowledgeItem, payroll.id)
    assert before is not None
    old_data, payroll_id, operations_id = before.cognee_data_id, payroll.id, ready["operations"].id
    await db.execute(
        update(Document).where(Document.id == payroll_id).values(access_group_id=operations_id)
    )
    await db.commit()
    assert await service.sync_once() is True
    after = await db.get(KnowledgeItem, payroll_id, populate_existing=True)
    assert after is not None
    assert old_data in fake.deleted
    assert after.scope_id == operations_id and after.cognee_data_id != old_data


async def test_semantic_hits_never_cross_access(
    ready: dict[str, Any],
    cognee: tuple[FakeCognee, KnowledgeService],
    client_for: MakeClient,
) -> None:
    await cognee[1].sync_once()
    dana = await client_for(ready["dana"])  # Operations only
    chat = await new_chat(dana)
    out = await ask(dana, chat, "When does payroll run each month?")
    titles = [s["title"] for s in out["sources"]]
    assert "Payroll Calendar 2027" not in titles
    assert "25th" not in out["text"]
    assert out["retrieval"]["semantic"] == "ok"

    sam = await client_for(ready["sam"])  # Finance
    chat = await new_chat(sam)
    out = await ask(sam, chat, "When does payroll run each month?")
    assert out["sources"][0]["title"] == "Payroll Calendar 2027"


async def test_removed_access_applies_to_semantic_search_immediately(
    ready: dict[str, Any],
    cognee: tuple[FakeCognee, KnowledgeService],
    client_for: MakeClient,
    db: AsyncSession,
) -> None:
    await cognee[1].sync_once()
    sam = await client_for(ready["sam"])
    from sqlalchemy import delete

    await db.execute(delete(Membership).where(Membership.user_id == ready["sam"].id))
    await db.commit()
    chat = await new_chat(sam)
    out = await ask(sam, chat, "When does payroll run each month?")
    assert "Payroll Calendar 2027" not in [s["title"] for s in out["sources"]]


async def test_stale_index_entries_are_ignored(
    ready: dict[str, Any],
    cognee: tuple[FakeCognee, KnowledgeService],
    client_for: MakeClient,
    db: AsyncSession,
) -> None:
    """Content changed but not yet re-indexed: the old chunks are not used."""
    await cognee[1].sync_once()
    payroll = await db.scalar(select(Document).where(Document.title == "Payroll Calendar 2027"))
    assert payroll is not None
    payroll_id = payroll.id
    await db.execute(
        update(Document).where(Document.id == payroll_id).values(content_hash="changed")
    )
    await db.commit()
    sam = await client_for(ready["sam"])
    allowed = await cognee[1].allowed_items(db, await _principal(db, ready["sam"]))
    assert payroll_id not in {doc.id for _, doc in allowed.values()}
    chat = await new_chat(sam)
    out = await ask(sam, chat, "bonus payments march september")
    assert out["retrieval"]["semantic"] == "ok"


async def test_cognee_down_falls_back_to_lexical(
    ready: dict[str, Any], cognee: tuple[FakeCognee, KnowledgeService], client_for: MakeClient
) -> None:
    service = cognee[1]
    await service.sync_once()

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    working = service.client
    service.client = CogneeClient(
        "http://cognee", username="u", password="p", transport=httpx.MockTransport(down)
    )
    try:
        sam = await client_for(ready["sam"])
        chat = await new_chat(sam)
        out = await ask(sam, chat, "When does payroll run?")
        assert out["retrieval"]["semantic"] == "unavailable"
        assert out["sources"][0]["title"] == "Payroll Calendar 2027"
        body = (await sam.get("/api/knowledge/graph")).json()
        assert body["cognee"] == "unavailable"
        assert any(n["label"] == "Payroll Calendar 2027" for n in body["nodes"])
    finally:
        await service.client.aclose()
        service.client = working


async def _principal(db: AsyncSession, user: Any) -> Any:
    from app.api.deps import Principal
    from app.services.access import effective_groups

    return Principal(user=user, session=None, groups=await effective_groups(db, user))  # type: ignore[arg-type]


# ---------------------------------------------------------------- graph


async def test_graph_without_cognee_shows_documents_people_and_versions(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    body = (await dana.get("/api/knowledge/graph")).json()
    assert body["cognee"] == "off"
    labels = {n["label"]: n for n in body["nodes"]}
    assert "Payroll Calendar 2027" not in labels  # Finance only
    assert "Finance" not in labels  # not her group
    assert labels["Travel Policy v2"]["status"] == "approved"
    assert labels["Operations"]["kind"] == "group"  # also a team owner: linked, not a person
    by_id = {n["id"]: n["label"] for n in body["nodes"]}
    versions = {
        (by_id[e["source"]], by_id[e["target"]]) for e in body["edges"] if e["kind"] == "version"
    }
    assert ("Travel Policy", "Travel Policy v2") in versions
    assert ("Travel Policy v2", "Travel Policy v3") in versions
    assert any(e["kind"] == "owned_by" for e in body["edges"])


async def test_graph_entities_only_from_visible_documents(
    ready: dict[str, Any], cognee: tuple[FakeCognee, KnowledgeService], client_for: MakeClient
) -> None:
    await cognee[1].sync_once()
    dana = await client_for(ready["dana"])
    body = (await dana.get("/api/knowledge/graph")).json()
    assert body["cognee"] == "ok"
    entities = [n for n in body["nodes"] if n["kind"] == "entity"]
    assert entities, "entities from visible documents are shown"
    assert not any("Payroll" in n["label"] for n in entities)
    assert all(n["entity_type"] == "topic" for n in entities)
    ids = {n["id"] for n in body["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in body["edges"])

    sam = await client_for(ready["sam"])
    body = (await sam.get("/api/knowledge/graph")).json()
    assert any("Payroll" in n["label"] for n in body["nodes"] if n["kind"] == "entity")


async def test_graph_requires_sign_in(anon: Any) -> None:
    assert (await anon.get("/api/knowledge/graph")).status_code == 401


async def test_admin_knowledge_status(
    ready: dict[str, Any], cognee: tuple[FakeCognee, KnowledgeService], client_for: MakeClient
) -> None:
    await cognee[1].sync_once()
    alex = await client_for(ready["alex"])
    body = (await alex.get("/api/admin/knowledge")).json()
    assert body["answer_engine"] == "preview"
    assert body["indexed"] > 0 and body["pending"] == 0
    assert (await alex.post("/api/admin/knowledge/sync")).status_code == 202
    dana = await client_for(ready["dana"])
    assert (await dana.get("/api/admin/knowledge")).status_code == 403


def test_entities_naming_existing_nodes_are_merged() -> None:
    from app.services.knowledge.graph import Graph, add_cognee_entities

    graph = Graph()
    doc_id = uuid.uuid4()
    data_id = uuid.uuid4()
    graph.node(f"doc:{doc_id}", kind="document", label="Travel Policy v2")
    graph.node("person:alex-morgan", kind="person", label="Alex Morgan")
    raw = {
        "nodes": [
            {"id": "c", "type": "DocumentChunk", "properties": {"document_id": str(data_id)}},
            {"id": "e1", "type": "Entity", "label": "alex morgan"},
            {"id": "e2", "type": "Entity", "label": "per diem"},
        ],
        "edges": [
            {"source": "c", "target": "e1", "label": "contains"},
            {"source": "c", "target": "e2", "label": "contains"},
            {"source": "e1", "target": "e2", "label": "approves"},
        ],
    }
    added = add_cognee_entities(graph, [raw], {data_id: doc_id})
    assert added == 1
    labels = sorted(n["label"] for n in graph.nodes.values())
    assert labels == ["Alex Morgan", "Travel Policy v2", "per diem"]
    assert ("person:alex-morgan", "entity:e2", "relation") in graph.edges
