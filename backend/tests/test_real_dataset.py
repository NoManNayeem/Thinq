"""Runs only where the private assessment dataset is present (docs/ is not in the repo)."""

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
