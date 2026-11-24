"""Runs a private golden set against a private dataset, where both are present.

Neither lives in the repository: point ``THINQ_PRIVATE_EVAL`` at a golden file (default
``docs/eval/brief.json``) whose ``data`` names the dataset folder. The file format is the one
``app.eval`` uses, plus optional ``expected_flags`` and ``expected_proposals``.
"""

import json
import os
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import eval as evaluation
from app.models import StatusProposal
from app.services.seed import seed_from_dir
from tests.conftest import BASE_URL
from tests.test_documents_import import open_flags

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = Path(os.environ.get("THINQ_PRIVATE_EVAL", ROOT / "docs" / "eval" / "brief.json"))
SPEC: dict[str, Any] = json.loads(GOLDEN.read_text()) if GOLDEN.is_file() else {}
DATA = ROOT / SPEC.get("data", "docs/data")
PASSWORD = "dataset-password-1"
pytestmark = pytest.mark.skipif(
    not SPEC or not (DATA / "manifest.csv").is_file(), reason="private golden set not present"
)


async def test_private_dataset_golden_set(db: AsyncSession, scan: Any, app: Any) -> None:
    await seed_from_dir(db, DATA, PASSWORD)
    await db.commit()
    await scan(DATA)

    if "expected_flags" in SPEC:
        flags = await open_flags(db)
        assert {k: sorted(v) for k, v in flags.items()} == {
            k: sorted(v) for k, v in SPEC["expected_flags"].items()
        }
    if "expected_proposals" in SPEC:
        rows = (
            await db.scalars(
                select(StatusProposal).options(
                    selectinload(StatusProposal.document), selectinload(StatusProposal.evidence)
                )
            )
        ).all()
        got = sorted(
            (p.document.title, p.proposed_status, p.evidence.title)
            for p in rows
            if p.state == "open"
        )
        want = sorted(
            (p["document"], p["status"], p["evidence"]) for p in SPEC["expected_proposals"]
        )
        assert got == want

    results = await evaluation.run(
        SPEC["cases"],
        base_url=BASE_URL,
        password=PASSWORD,
        admin_email=SPEC.get("admin"),
        transport=ASGITransport(app=app),
    )
    assert all(r.passed for r in results), evaluation.report(results)
