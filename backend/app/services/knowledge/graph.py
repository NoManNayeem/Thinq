"""The knowledge graph a person may see.

Built from Thinq's own records, so it works with or without Cognee:
- documents (with status), their owners and their access groups;
- version families ("Travel Policy", "Travel Policy v2", "Travel Policy v3"), oldest to newest;
- references: one document naming another.

When the Cognee knowledge layer is on, the entities it extracted are added, attached to the
documents that mention them.

Access rule: every node is reachable only through a document the person can see *now*
(``visible_documents``). Cognee graphs are read only for that person's datasets, and an entity is
kept only if one of those visible documents mentions it; relations are kept only between kept
entities. Group nodes are only the groups the person belongs to.
"""

import itertools
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import PurePath
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import Principal
from app.models import Document
from app.services.documents.access import visible_documents

MAX_ENTITIES = 160
VERSION_WORDS = re.compile(
    r"\b(v\d+|final|draft|copy|\d{4}(-\d{2}(-\d{2})?)?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|\d{1,2})\b"
)


@dataclass
class Graph:
    nodes: dict[str, dict[str, Any]] = field(default_factory=dict)
    edges: dict[tuple[str, str, str], dict[str, Any]] = field(default_factory=dict)

    def node(self, node_id: str, **attrs: Any) -> str:
        if node_id not in self.nodes:
            self.nodes[node_id] = {"id": node_id, **attrs}
        return node_id

    def edge(self, source: str, target: str, kind: str, label: str) -> None:
        if source != target:
            self.edges.setdefault(
                (source, target, kind),
                {"source": source, "target": target, "kind": kind, "label": label},
            )

    def out(self) -> dict[str, Any]:
        degree: dict[str, int] = defaultdict(int)
        for s, t, _ in self.edges:
            degree[s] += 1
            degree[t] += 1
        nodes = [{**n, "degree": degree[n["id"]]} for n in self.nodes.values()]
        return {"nodes": nodes, "edges": list(self.edges.values())}


def family_key(title: str) -> str:
    words = VERSION_WORDS.sub(" ", title.lower().replace(":", " "))
    return " ".join(re.findall(r"[a-z]+", words))


def _names(doc: Document) -> list[str]:
    stem = PurePath(doc.source_path).stem.replace("_", " ").strip()
    names = {doc.title.strip().lower(), stem.lower()}
    return [n for n in names if len(n) >= 8]


def _person_id(name: str) -> str:
    return "person:" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


async def visible_graph_documents(db: AsyncSession, principal: Principal) -> list[Document]:
    return list(
        (
            await db.scalars(
                visible_documents(principal)
                .where(Document.is_registered.is_(True))
                .options(selectinload(Document.access_group))
                .order_by(Document.title)
            )
        ).all()
    )


def document_graph(docs: list[Document], principal: Principal) -> Graph:
    graph = Graph()
    member_of = {g.id for g in principal.groups}
    groups_by_name = {g.name.lower(): g for g in principal.groups}
    for doc in docs:
        doc_node = graph.node(
            f"doc:{doc.id}",
            kind="document",
            label=doc.title,
            status=doc.status,
            document_id=str(doc.id),
            owner=doc.owner_name,
            group=doc.access_group.name if doc.access_group else None,
            last_reviewed=doc.last_reviewed.isoformat() if doc.last_reviewed else None,
        )
        group = doc.access_group
        if group is not None and group.id in member_of:
            graph.edge(
                doc_node,
                graph.node(f"group:{group.id}", kind="group", label=group.name),
                "shared_with",
                "shared with",
            )
        if doc.owner_name:
            team = groups_by_name.get(doc.owner_name.strip().lower())
            owner = (
                graph.node(f"group:{team.id}", kind="group", label=team.name)
                if team is not None  # a team as owner: link to the group itself
                else graph.node(_person_id(doc.owner_name), kind="person", label=doc.owner_name)
            )
            graph.edge(doc_node, owner, "owned_by", "owned by")

    families: dict[str, list[Document]] = defaultdict(list)
    for doc in docs:
        key = family_key(doc.title)
        if key:
            families[key].append(doc)
    for members in families.values():
        members.sort(key=lambda d: (d.last_modified or d.created_at.date(), d.title))
        for older, newer in itertools.pairwise(members):
            graph.edge(f"doc:{older.id}", f"doc:{newer.id}", "version", "next version")

    for doc in docs:
        text = doc.content.lower()
        for other in docs:
            if (
                other.id != doc.id
                and family_key(other.title) != family_key(doc.title)
                and any(name in text for name in _names(other))
            ):
                graph.edge(f"doc:{doc.id}", f"doc:{other.id}", "references", "refers to")
    return graph


def add_cognee_entities(
    graph: Graph,
    raw_graphs: list[dict[str, Any]],
    data_to_document: dict[uuid.UUID, uuid.UUID],
) -> int:
    """Attach Cognee entities to the visible documents that mention them. Returns entities added."""
    entity_types: dict[str, str] = {}
    entities: dict[str, dict[str, Any]] = {}
    chunk_doc: dict[str, uuid.UUID] = {}
    mentions: dict[str, set[uuid.UUID]] = defaultdict(set)
    relations: list[tuple[str, str, str]] = []

    for raw in raw_graphs:
        nodes = {str(n.get("id")): n for n in raw.get("nodes", [])}
        for node_id, n in nodes.items():
            kind = n.get("type")
            if kind == "Entity":
                entities[node_id] = n
            elif kind == "DocumentChunk":
                props = n.get("properties") or {}
                try:
                    data_id = uuid.UUID(str(props.get("document_id")))
                except ValueError:
                    continue
                if data_id in data_to_document:
                    chunk_doc[node_id] = data_to_document[data_id]
        for e in raw.get("edges", []):
            s, t, label = str(e.get("source")), str(e.get("target")), str(e.get("label") or "")
            if label == "is_a" and s in entities and nodes.get(t, {}).get("type") == "EntityType":
                entity_types[s] = str(nodes[t].get("label") or "")
            elif label == "contains" and s in chunk_doc and t in entities:
                mentions[t].add(chunk_doc[s])
            elif s in entities and t in entities:
                relations.append((s, t, label))

    # Keep only entities a visible, current document mentions; the most connected first.
    kept = sorted((e for e in mentions if mentions[e]), key=lambda e: (-len(mentions[e]), e))[
        :MAX_ENTITIES
    ]
    kept_set = set(kept)
    # An entity that names something already on the graph (a person, group or document) is
    # that thing: merge into it instead of drawing a duplicate.
    existing = {
        str(n["label"]).strip().lower(): node_id
        for node_id, n in graph.nodes.items()
        if n.get("kind") in ("person", "group", "document")
    }
    node_of: dict[str, str] = {}
    for entity_id in kept:
        n = entities[entity_id]
        props = n.get("properties") or {}
        same = existing.get(str(n.get("label") or "").strip().lower())
        if same is not None:
            node_of[entity_id] = same
            for doc_id in mentions[entity_id]:
                if f"doc:{doc_id}" in graph.nodes and same.startswith("doc:"):
                    graph.edge(f"doc:{doc_id}", same, "references", "refers to")
            continue
        node = graph.node(
            f"entity:{entity_id}",
            kind="entity",
            label=str(n.get("label") or "")[:80],
            entity_type=entity_types.get(entity_id),
            description=str(props.get("description") or "")[:300] or None,
        )
        node_of[entity_id] = node
        for doc_id in mentions[entity_id]:
            if f"doc:{doc_id}" in graph.nodes:
                graph.edge(f"doc:{doc_id}", node, "mentions", "mentions")
    for s, t, label in relations:
        if s in kept_set and t in kept_set:
            graph.edge(node_of[s], node_of[t], "relation", label.replace("_", " ")[:60])
    return sum(1 for n in node_of.values() if n.startswith("entity:"))
