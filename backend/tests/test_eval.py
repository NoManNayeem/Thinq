"""The public golden set (seed/sample/eval.json), run through the real API in-process.

This is the CI gate for answer quality: any failing case fails the build, and the ``access``
cases are the ones that must never fail.
"""

import json
from pathlib import Path
from typing import Any

from httpx import ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app import eval as evaluation
from app.services.seed import seed_from_dir
from tests.conftest import BASE_URL

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
SPEC = json.loads((SAMPLE / "eval.json").read_text())
PASSWORD = "sample-password-1"


async def test_sample_golden_set(db: AsyncSession, scan: Any, app: Any) -> None:
    await seed_from_dir(db, SAMPLE, PASSWORD)
    await db.commit()
    await scan(SAMPLE)
    results = await evaluation.run(
        SPEC["cases"],
        base_url=BASE_URL,
        password=PASSWORD,
        admin_email=SPEC["admin"],
        transport=ASGITransport(app=app),
    )
    assert all(r.passed for r in results), evaluation.report(results)
    assert any("access" in r.tags for r in results)


def test_checks_catch_leaks_and_wrong_sources() -> None:
    out = {
        "text": "Payroll runs on the 25th.",
        "sources": [{"title": "Payroll Calendar 2027", "status": "approved", "excerpt": ""}],
        "notices": [],
        "retrieval": {"engine": "ai"},
        "error": None,
    }
    case = {
        "expect": {
            "sources_exclude": ["Payroll Calendar 2027"],
            "facts_none": ["25th"],
            "top_source": "Something else",
        }
    }
    failures = evaluation.check(case, out)
    assert len(failures) == 3
