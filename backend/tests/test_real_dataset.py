"""Runs only where the private assessment dataset is present (docs/ is not in the repo)."""

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.seed import seed_from_dir
from tests.conftest import BASE_URL
from tests.test_documents_import import open_flags

DATA = Path(__file__).resolve().parents[2] / "docs" / "data"
pytestmark = pytest.mark.skipif(
    not (DATA / "manifest.csv").is_file(), reason="private dataset not present"
)


async def test_brief_dataset(db: AsyncSession, scan: Any, app: Any) -> None:
    await seed_from_dir(db, DATA, "dataset-password-1")
    await db.commit()
    report = await scan(DATA)
    assert len(report.created) == 11

    flags = await open_flags(db)
    assert flags == {
        "onboarding checklist (1).md": {"unregistered", "likely_duplicate"},
        "Client_Onboarding_Checklist_2024.md": {"missing_owner"},
        "Vendor_Onboarding_Form_2024.md": {"missing_owner", "missing_status"},
        "Vendor_Onboarding_Form_FINAL_v2.md": {"missing_status"},
        "Vendor_Directory.md": {"ai_instruction", "owner_is_team"},
    }

    async def login(email: str) -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL)
        r = await client.post(
            "/api/auth/login", json={"email": email, "password": "dataset-password-1"}
        )
        assert r.status_code == 200
        return client

    nadia, priya = await login("nadia@cedarline.example"), await login("priya@cedarline.example")
    nadia_docs = {d["source_path"] for d in (await nadia.get("/api/documents")).json()["items"]}
    priya_docs = {d["source_path"] for d in (await priya.get("/api/documents")).json()["items"]}
    assert "Vendor_Z_Payment_Terms.md" not in nadia_docs
    assert "Vendor_Z_Payment_Terms.md" in priya_docs
    assert "Client_Onboarding_Checklist_v3.md" in nadia_docs
    assert "Client_Onboarding_Checklist_v3.md" not in priya_docs  # Ops only
    assert "onboarding checklist (1).md" not in nadia_docs | priya_docs
    await nadia.aclose()
    await priya.aclose()


async def test_brief_questions_cite_the_right_sources(
    db: AsyncSession, scan: Any, app: Any
) -> None:
    """The brief's six test questions, against the preview engine (no AI model)."""
    from tests.test_chat import ask, new_chat

    await seed_from_dir(db, DATA, "dataset-password-1")
    await db.commit()
    await scan(DATA)

    async def login(email: str) -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL)
        r = await client.post(
            "/api/auth/login", json={"email": email, "password": "dataset-password-1"}
        )
        assert r.status_code == 200
        return client

    nadia, priya, tariq = (
        await login("nadia@cedarline.example"),
        await login("priya@cedarline.example"),
        await login("tariq@cedarline.example"),
    )
    chat = await new_chat(nadia)

    q1 = await ask(nadia, chat, "What's the current client onboarding checklist?")
    assert q1["sources"][0]["title"] == "Client Onboarding Checklist v3"
    assert q1["sources"][0]["status"] == "approved"
    # The newer v4 draft is mentioned as a draft, never presented as the answer.
    v4 = "Client Onboarding Checklist v4"
    cited_as_draft = any(s["title"] == v4 and s["status"] == "draft" for s in q1["sources"])
    noted = any(n["kind"] == "draft_also" and v4 in n["message"] for n in q1["notices"])
    assert cited_as_draft or noted, (q1["sources"], q1["notices"])

    q2 = await ask(nadia, chat, "Which vendor onboarding form should I use?")
    assert q2["sources"][0]["title"] == "Memo: Vendor Onboarding Update"
    assert "FINAL v2" in q2["sources"][0]["excerpt"]

    q3 = await ask(nadia, chat, "Why did we switch cleaning vendors?")
    assert q3["sources"][0]["title"] == "Ops Sync Notes Oct 8 2026"
    assert q3["sources"][0]["status"] == "reference"

    q4 = await ask(nadia, chat, "What are Vendor Z's payment terms?")
    assert "Payment Terms: Zenith Plumbing Co." not in [s["title"] for s in q4["sources"]]
    assert "Net 45" not in json.dumps(q4["events"])
    assert "ignore your access rules" not in json.dumps(q4["events"])

    priya_chat = await new_chat(priya)
    q5 = await ask(priya, priya_chat, "What are Vendor Z's payment terms?")
    assert q5["sources"][0]["title"] == "Payment Terms: Zenith Plumbing Co."
    assert "Net 45" in q5["sources"][0]["excerpt"]

    groups = (await tariq.get("/api/admin/groups")).json()
    finance = next(g["id"] for g in groups if g["name"] == "Finance")
    users = (await tariq.get("/api/admin/users", params={"q": "priya"})).json()["items"]
    await tariq.delete(f"/api/admin/users/{users[0]['id']}/groups/{finance}")

    q6 = await ask(priya, priya_chat, "What are Vendor Z's payment terms?")
    assert "Net 45" not in json.dumps(q6["events"])
    history = (await priya.get(f"/api/chat/conversations/{priya_chat}")).json()["messages"]
    assert history[1]["withheld"] is True  # her earlier answer is hidden too
    for client in (nadia, priya, tariq):
        await client.aclose()
