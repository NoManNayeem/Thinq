"""Keeps Cognee in step with Thinq's documents, and searches it on behalf of a person.

Layout: one Cognee dataset per access group, plus one for documents shared with no group
(Admins only). A document lives in exactly one dataset, the one for its access group, so a
dataset holds only documents that the same people may see.

Sync is state-based: every cycle compares what *should* be indexed (registered, not Outdated)
with what Thinq has recorded in ``knowledge_items``, and fixes the difference. Edits, rescans and
group changes are therefore picked up without hooks in every code path; ``nudge()`` just makes
the next cycle start now.

Search never trusts Cognee for access. A hit is used only if its data id maps, through Thinq's own
``knowledge_items`` table, to the *current* version of a document the person can see right now.
"""

import asyncio
import contextlib
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import structlog
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import Principal
from app.core.config import Settings
from app.models import Document, DocumentStatus, KnowledgeDataset, KnowledgeItem
from app.services.documents.access import visible_documents
from app.services.documents.checks import ai_instruction_lines
from app.services.knowledge.cognee_client import CogneeClient, CogneeError

log = structlog.get_logger(__name__)

UNSHARED_SCOPE = uuid.UUID(int=0)  # documents with no access group: Admins only
GRAPH_CACHE_S = 60


@dataclass(frozen=True)
class SemanticHit:
    document_id: uuid.UUID
    text: str
    distance: float
    rank: int


@dataclass(frozen=True)
class _Doc:
    id: uuid.UUID
    scope: uuid.UUID
    content_hash: str
    version: int
    text: str


@dataclass
class SyncState:
    running: bool = False
    last_started: float | None = None
    last_finished: float | None = None
    last_error: str | None = None
    reachable: bool | None = None


@dataclass
class _GraphCache:
    at: float
    graph: dict[str, Any]


@dataclass
class KnowledgeService:
    settings: Settings
    sessionmaker: async_sessionmaker[AsyncSession]
    client: CogneeClient
    state: SyncState = field(default_factory=SyncState)
    _wake: asyncio.Event = field(default_factory=asyncio.Event)
    _graphs: dict[uuid.UUID, _GraphCache] = field(default_factory=dict)

    @classmethod
    def from_settings(
        cls, settings: Settings, sessionmaker: async_sessionmaker[AsyncSession]
    ) -> KnowledgeService:
        client = CogneeClient(
            settings.cognee_url,
            username=settings.cognee_user,
            password=settings.cognee_password,
            timeout_s=settings.cognee_timeout_s,
            index_timeout_s=settings.cognee_index_timeout_s,
        )
        return cls(settings=settings, sessionmaker=sessionmaker, client=client)

    # ------------------------------------------------------------------ sync

    def nudge(self) -> None:
        self._wake.set()

    async def run_forever(self) -> None:
        while True:
            try:
                await self.sync_once()
            except Exception as exc:  # keep the loop alive whatever happens
                self.state.last_error = str(exc)[:500]
                log.warning("knowledge sync failed", error=self.state.last_error)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), self.settings.cognee_sync_interval_s)
            self._wake.clear()

    def _dataset_name(self, scope_id: uuid.UUID) -> str:
        label = "unshared" if scope_id == UNSHARED_SCOPE else scope_id.hex[:16]
        return f"{self.settings.cognee_dataset_prefix}_{label}"

    async def _dataset(self, db: AsyncSession, scope_id: uuid.UUID) -> uuid.UUID:
        row = await db.get(KnowledgeDataset, scope_id)
        if row is not None:
            return row.cognee_dataset_id
        name = self._dataset_name(scope_id)
        dataset_id = await self.client.ensure_dataset(name)
        db.add(KnowledgeDataset(scope_id=scope_id, name=name, cognee_dataset_id=dataset_id))
        await db.flush()
        return dataset_id

    @staticmethod
    def indexable_text(doc: Document) -> str:
        """Document text as indexed: lines aimed at an AI assistant are left out entirely."""
        injected = set(ai_instruction_lines(doc.content))
        lines = [line for line in doc.content.splitlines() if line.strip()[:240] not in injected]
        body = "\n".join(lines).strip()
        return body if body.startswith("# ") else f"# {doc.title}\n\n{body}"

    async def sync_once(self) -> bool:
        """One reconcile pass. Returns True if anything changed."""
        if self.state.running:
            return False
        self.state.running = True
        self.state.last_started = time.time()
        changed = False
        try:
            async with self.sessionmaker() as db:
                changed = await self._reconcile(db)
            self.state.reachable = True
            self.state.last_error = None
        except CogneeError as exc:
            self.state.reachable = await self.client.health()
            self.state.last_error = str(exc)[:500]
            raise
        finally:
            self.state.running = False
            self.state.last_finished = time.time()
        if changed:
            self._graphs.clear()
        return changed

    async def _reconcile(self, db: AsyncSession) -> bool:
        docs = [
            _Doc(
                id=d.id,
                scope=d.access_group_id or UNSHARED_SCOPE,
                content_hash=d.content_hash,
                version=d.current_version,
                text=self.indexable_text(d),
            )
            for d in (
                await db.scalars(
                    select(Document).where(
                        Document.is_registered.is_(True),
                        Document.source_present.is_(True),
                        Document.status != DocumentStatus.OUTDATED.value,
                    )
                )
            ).all()
        ]
        desired = {d.id: d for d in docs}
        items = {i.document_id: i for i in (await db.scalars(select(KnowledgeItem))).all()}
        changed = False

        # 1. Remove what shouldn't be there any more, or moved group, or changed content.
        for doc_id, item in list(items.items()):
            doc = desired.get(doc_id)
            if (
                doc is not None
                and item.scope_id == doc.scope
                and item.content_hash == doc.content_hash
            ):
                continue
            if item.cognee_data_id is not None:
                try:
                    await self.client.delete_document(item.cognee_dataset_id, item.cognee_data_id)
                except CogneeError as exc:
                    log.warning(
                        "could not remove from cognee", document_id=str(doc_id), error=str(exc)
                    )
            await db.execute(delete(KnowledgeItem).where(KnowledgeItem.document_id == doc_id))
            del items[doc_id]
            changed = True
        await db.commit()

        # 2. Add what's missing.
        for doc in docs:
            if doc.id in items:
                continue
            dataset_id = await self._dataset(db, doc.scope)
            data_id = await self.client.add_document(
                dataset_id,
                filename=f"{doc.id}.md",
                text=doc.text,
                metadata={"thinq_document_id": str(doc.id), "version": str(doc.version)},
            )
            item = KnowledgeItem(
                document_id=doc.id,
                scope_id=doc.scope,
                cognee_dataset_id=dataset_id,
                cognee_data_id=data_id,
                content_hash=doc.content_hash,
                version=doc.version,
                status="pending",
            )
            db.add(item)
            await db.commit()
            items[doc.id] = item
            changed = True

        # 3. Build the graph for datasets with pending (or previously failed) items.
        waiting: dict[uuid.UUID, list[uuid.UUID]] = {}
        for row in (
            await db.execute(
                select(KnowledgeItem.cognee_dataset_id, KnowledgeItem.document_id).where(
                    KnowledgeItem.status != "indexed"
                )
            )
        ).all():
            waiting.setdefault(row[0], []).append(row[1])
        for dataset_id, pending in waiting.items():
            try:
                await self.client.cognify([dataset_id])
            except CogneeError as exc:
                await self._mark(db, pending, "failed", str(exc)[:500])
                raise
            await self._mark(db, pending, "indexed", None)
            changed = True
        return changed

    @staticmethod
    async def _mark(
        db: AsyncSession, document_ids: list[uuid.UUID], status: str, error: str | None
    ) -> None:
        await db.execute(
            update(KnowledgeItem)
            .where(KnowledgeItem.document_id.in_(document_ids))
            .values(status=status, error=error)
        )
        await db.commit()

    # ------------------------------------------------------------------ reads

    @staticmethod
    def scopes_for(principal: Principal) -> list[uuid.UUID]:
        scopes = [g.id for g in principal.groups]
        if principal.user.is_admin:
            scopes.append(UNSHARED_SCOPE)
        return scopes

    async def _datasets_for(self, db: AsyncSession, principal: Principal) -> list[uuid.UUID]:
        scopes = self.scopes_for(principal)
        if not scopes:
            return []
        rows = await db.scalars(
            select(KnowledgeDataset.cognee_dataset_id).where(KnowledgeDataset.scope_id.in_(scopes))
        )
        return list(rows.all())

    async def _current_items(
        self, db: AsyncSession, principal: Principal
    ) -> dict[uuid.UUID, tuple[KnowledgeItem, Document]]:
        """Indexed items, keyed by Cognee data id, whose document the person can see *now*
        and whose indexed content is the document's current content."""
        rows = (
            await db.execute(
                select(KnowledgeItem, Document)
                .join(Document, Document.id == KnowledgeItem.document_id)
                .where(
                    Document.id.in_(visible_documents(principal).with_only_columns(Document.id)),
                    KnowledgeItem.cognee_data_id.is_not(None),
                )
            )
        ).all()
        return {
            item.cognee_data_id: (item, doc)
            for item, doc in rows
            if item.cognee_data_id is not None and item.content_hash == doc.content_hash
        }

    async def search(
        self, db: AsyncSession, principal: Principal, question: str, *, top_k: int = 12
    ) -> list[SemanticHit]:
        datasets = await self._datasets_for(db, principal)
        if not datasets:
            return []
        hits = await self.client.search_chunks(question, datasets, top_k=top_k)
        allowed = await self._current_items(db, principal)
        out: list[SemanticHit] = []
        for hit in hits:
            if hit.cognee_data_id is None or hit.cognee_data_id not in allowed:
                continue  # unknown, stale, or not visible to this person: never used
            _, doc = allowed[hit.cognee_data_id]
            out.append(
                SemanticHit(document_id=doc.id, text=hit.text, distance=hit.score, rank=hit.rank)
            )
        return out

    async def raw_graphs(self, db: AsyncSession, principal: Principal) -> list[dict[str, Any]]:
        """Cognee graphs for the datasets this person's groups cover (cached briefly)."""
        out = []
        for dataset_id in await self._datasets_for(db, principal):
            cached = self._graphs.get(dataset_id)
            if cached and time.time() - cached.at < GRAPH_CACHE_S:
                out.append(cached.graph)
                continue
            graph = await self.client.dataset_graph(dataset_id)
            self._graphs[dataset_id] = _GraphCache(at=time.time(), graph=graph)
            out.append(graph)
        return out

    async def allowed_items(
        self, db: AsyncSession, principal: Principal
    ) -> dict[uuid.UUID, tuple[KnowledgeItem, Document]]:
        return await self._current_items(db, principal)

    async def counts(self, db: AsyncSession) -> dict[str, int]:
        rows = (await db.scalars(select(KnowledgeItem.status))).all()
        out = {"indexed": 0, "pending": 0, "failed": 0}
        for status in rows:
            out[status] = out.get(status, 0) + 1
        return out
