from fastapi import APIRouter, Request, status

from app.api.deps import AdminDep, DbDep
from app.schemas.common import error_responses
from app.schemas.knowledge import KnowledgeStatusOut
from app.services.chat.engines import get_engine
from app.services.knowledge.service import KnowledgeService

router = APIRouter(prefix="/admin/knowledge", tags=["admin: knowledge"])
ERRORS = error_responses(401, 403)


@router.get("", response_model=KnowledgeStatusOut, responses=ERRORS)
async def knowledge_status(_: AdminDep, db: DbDep, request: Request) -> KnowledgeStatusOut:
    settings = request.app.state.settings
    engine = get_engine(settings)
    knowledge: KnowledgeService | None = request.app.state.knowledge
    counts = await knowledge.counts(db) if knowledge else {"indexed": 0, "pending": 0, "failed": 0}
    state = knowledge.state if knowledge else None
    return KnowledgeStatusOut(
        retriever=settings.retriever,
        answer_engine=engine.name,
        model=engine.model,
        cognee_reachable=state.reachable if state else None,
        syncing=state.running if state else False,
        last_synced_at=state.last_finished if state else None,
        last_error=state.last_error if state else None,
        indexed=counts.get("indexed", 0),
        pending=counts.get("pending", 0),
        failed=counts.get("failed", 0),
    )


@router.post("/sync", status_code=status.HTTP_202_ACCEPTED, responses=ERRORS)
async def sync_now(_: AdminDep, request: Request) -> None:
    """Start a sync with the knowledge layer now instead of waiting for the next cycle."""
    knowledge: KnowledgeService | None = request.app.state.knowledge
    if knowledge is not None:
        knowledge.nudge()
