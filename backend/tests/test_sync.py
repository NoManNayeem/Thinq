"""Sources and sync: edits, deletions, renames and moves, failures, uploads, history."""

from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, DocumentScan, DocumentVersion
from app.services.documents import sync as sync_module
from app.services.documents.sync import SyncFailed, run_sync
from tests.conftest import MakeClient
from tests.test_chat import ask, new_chat
from tests.test_trust import doc_id


@pytest.fixture
async def ready(seed_copy: Path, sample_org: dict[str, Any], scan: Any) -> dict[str, Any]:
    await scan(seed_copy)
    return sample_org


async def resync(app: FastAPI) -> Any:
    return await run_sync(app.state.sessionmaker, app.state.settings, trigger="manual")


async def test_edit_creates_a_version_on_the_next_sync(
    ready: dict[str, Any], seed_copy: Path, app: FastAPI, client_for: MakeClient
) -> None:
    path = seed_copy / "documents" / "IT_Help_Desk.md"
    path.write_text(path.read_text() + "\n| Printer jam | Facilities desk | Same day |\n")
    report = await resync(app)
    assert report.updated == ["IT_Help_Desk.md"]
    alex = await client_for(ready["alex"])
    desk = (await alex.get(f"/api/documents/{await doc_id(alex, 'IT Help Desk')}")).json()
    assert desk["current_version"] == 2 and "Printer jam" in desk["content"]


async def test_deleted_file_leaves_answers_immediately(
    ready: dict[str, Any], seed_copy: Path, app: FastAPI, client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    before = await ask(dana, await new_chat(dana), "How do I get a new laptop?")
    assert before["sources"][0]["title"] == "IT Help Desk"
    (seed_copy / "documents" / "IT_Help_Desk.md").unlink()
    report = await resync(app)
    assert report.missing == ["IT_Help_Desk.md"]
    after = await ask(dana, await new_chat(dana), "How do I get a new laptop?")
    assert "IT Help Desk" not in [s["title"] for s in after["sources"]]
    graph = (await dana.get("/api/knowledge/graph")).json()
    assert "IT Help Desk" not in [n["label"] for n in graph["nodes"]]
    # Still listed in the library, marked as missing from the source.
    desk = (await dana.get(f"/api/documents/{await doc_id(dana, 'IT Help Desk')}")).json()
    assert desk["source_present"] is False


async def test_rename_and_move_keep_metadata_and_history(
    ready: dict[str, Any], seed_copy: Path, app: FastAPI, client_for: MakeClient, db: AsyncSession
) -> None:
    alex = await client_for(ready["alex"])
    desk_id = await doc_id(alex, "IT Help Desk")
    docs = seed_copy / "documents"
    (docs / "IT_Help_Desk.md").rename(docs / "Help_Desk_2026.md")
    report = await resync(app)
    assert report.renamed == [{"from": "IT_Help_Desk.md", "to": "Help_Desk_2026.md"}]
    (docs / "it").mkdir()
    (docs / "Help_Desk_2026.md").rename(docs / "it" / "Help_Desk_2026.md")
    report = await resync(app)
    assert report.renamed == [{"from": "Help_Desk_2026.md", "to": "it/Help_Desk_2026.md"}]
    assert not report.created and not report.missing

    desk = (await alex.get(f"/api/documents/{desk_id}")).json()  # same document
    assert desk["source_path"] == "it/Help_Desk_2026.md"
    assert desk["status"] == "approved" and desk["owner"]["name"] == "Alex Morgan"
    versions = await db.scalar(
        select(func.count())
        .select_from(DocumentVersion)
        .where(DocumentVersion.document_id == desk_id)
    )
    assert versions == 1


async def test_failed_sync_changes_nothing_and_is_visible(
    ready: dict[str, Any],
    seed_copy: Path,
    app: FastAPI,
    client_for: MakeClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (seed_copy / "documents" / "New_Note.md").write_text("# New note\n\nHello.\n")
    original = sync_module.FolderSource.sync

    async def explode(self: Any, db: AsyncSession, **kwargs: Any) -> Any:
        await original(self, db, **kwargs)  # does all the work, then fails before commit
        raise OSError("disk went away")

    monkeypatch.setattr(sync_module.FolderSource, "sync", explode)
    with pytest.raises(SyncFailed):
        await resync(app)
    assert await db.scalar(select(Document).where(Document.source_path == "New_Note.md")) is None
    alex = await client_for(ready["alex"])
    history = (await alex.get("/api/admin/documents/scans")).json()
    assert history[0]["error"].startswith("OSError: disk went away")
    assert (
        await db.scalar(
            select(func.count()).select_from(DocumentScan).where(DocumentScan.error.is_not(None))
        )
    ) == 1


async def test_upload_adds_a_document_and_new_versions(
    ready: dict[str, Any], app: FastAPI, client_for: MakeClient
) -> None:
    alex, dana = await client_for(ready["alex"]), await client_for(ready["dana"])
    body = {
        "filename": "Expense_Guide.md",
        "content": "# Expense Guide\n\nClaim expenses within 30 days.\n",
        "access_group_id": str(ready["operations"].id),
        "owner_name": "Alex Morgan",
        "status": "approved",
    }
    assert (await dana.post("/api/admin/documents/upload", json=body)).status_code == 403
    r = await alex.post("/api/admin/documents/upload", json=body)
    assert r.status_code == 201
    doc = r.json()
    assert doc["source_kind"] == "upload" and doc["title"] == "Expense Guide"
    assert (await alex.post("/api/admin/documents/upload", json=body)).status_code == 409
    body["content"] += "Receipts over $50 need a photo.\n"
    r = await alex.post("/api/admin/documents/upload", json=body)
    assert r.json()["current_version"] == 2
    # A folder sync never marks an upload as missing.
    await resync(app)
    assert (await alex.get(f"/api/documents/{doc['id']}")).json()["source_present"] is True
    out = await ask(dana, await new_chat(dana), "How long do I have to claim expenses?")
    assert out["sources"][0]["title"] == "Expense Guide"
    big = {**body, "filename": "Big.md", "content": "x" * (app.state.settings.upload_max_bytes + 1)}
    assert (await alex.post("/api/admin/documents/upload", json=big)).status_code == 413
    bad = {**body, "filename": "../etc/passwd.md"}
    assert (await alex.post("/api/admin/documents/upload", json=bad)).status_code == 422
