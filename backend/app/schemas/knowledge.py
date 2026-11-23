from typing import Literal

from pydantic import BaseModel

NodeKind = Literal["document", "group", "person", "entity"]
EdgeKind = Literal["shared_with", "owned_by", "version", "references", "mentions", "relation"]
LayerStatus = Literal["off", "ok", "indexing", "unavailable"]


class GraphNode(BaseModel):
    id: str
    kind: NodeKind
    label: str
    degree: int = 0
    status: str | None = None
    document_id: str | None = None
    owner: str | None = None
    group: str | None = None
    last_reviewed: str | None = None
    entity_type: str | None = None
    description: str | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: EdgeKind
    label: str


class KnowledgeGraphOut(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    cognee: LayerStatus
    answering_from: list[str]


class KnowledgeStatusOut(BaseModel):
    retriever: Literal["lexical", "cognee"]
    answer_engine: str
    model: str | None
    cognee_reachable: bool | None
    syncing: bool
    last_synced_at: float | None
    last_error: str | None
    indexed: int
    pending: int
    failed: int
