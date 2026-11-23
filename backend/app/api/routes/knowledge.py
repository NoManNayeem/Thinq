import structlog
from fastapi import APIRouter, Request

from app.api.deps import DbDep, PrincipalDep
from app.schemas.common import error_responses
from app.schemas.knowledge import KnowledgeGraphOut
from app.services.knowledge.cognee_client import CogneeError
from app.services.knowledge.graph import (
    add_cognee_entities,
    document_graph,
    visible_graph_documents,
)
from app.services.knowledge.service import KnowledgeService

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
log = structlog.get_logger(__name__)


@router.get("/graph", response_model=KnowledgeGraphOut, responses=error_responses(401))
async def knowledge_graph(
    principal: PrincipalDep, db: DbDep, request: Request
) -> KnowledgeGraphOut:
    """The graph of documents, owners, groups and (with Cognee) entities this person may see."""
    docs = await visible_graph_documents(db, principal)
    graph = document_graph(docs, principal)
    knowledge: KnowledgeService | None = request.app.state.knowledge
    layer = "off"
    if knowledge is not None:
        try:
            allowed = await knowledge.allowed_items(db, principal)
            data_to_document = {
                data_id: doc.id
                for data_id, (item, doc) in allowed.items()
                if item.status == "indexed"
            }
            raw = await knowledge.raw_graphs(db, principal) if data_to_document else []
            add_cognee_entities(graph, raw, data_to_document)
            layer = (
                "indexing"
                if knowledge.state.running or len(data_to_document) < len(allowed)
                else "ok"
            )
        except CogneeError as exc:
            layer = "unavailable"
            log.warning("knowledge graph unavailable", error=str(exc)[:200])
    out = graph.out()
    return KnowledgeGraphOut(
        nodes=out["nodes"],
        edges=out["edges"],
        cognee=layer,
        answering_from=[g.name for g in principal.groups],
    )
