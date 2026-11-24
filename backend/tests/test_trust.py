"""Trust and approval: families, who may change status, approve-retires-previous, review dates,
proposals from approved documents."""

from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, DocumentStatusChange
from app.services.documents.flags import reconcile_flags
from app.services.documents.trust import family_key, find_evidence
from tests.conftest import MakeClient


@pytest.fixture
async def ready(seed_copy: Path, sample_org: dict[str, Any], scan: Any) -> dict[str, Any]:
    await scan(seed_copy)
    return sample_org


async def doc_id(client: AsyncClient, title: str) -> str:
    items = (await client.get("/api/documents", params={"limit": 500})).json()["items"]
    return next(d["id"] for d in items if d["title"] == title)


async def test_family_shows_the_approved_version_as_current(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    v3 = (await dana.get(f"/api/documents/{await doc_id(dana, 'Travel Policy v3')}")).json()
    family = {m["title"]: m for m in v3["family"]}
    assert set(family) == {"Travel Policy", "Travel Policy v2", "Travel Policy v3"}
    assert family["Travel Policy v2"]["is_current"] is True  # newer v3 is only a draft
    assert family["Travel Policy v3"]["is_self"] is True
    assert v3["can_change_status"] is False  # Dana isn't the owner


async def test_only_owner_or_admin_can_change_status(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, sam = await client_for(ready["dana"]), await client_for(ready["sam"])
    v3 = await doc_id(dana, "Travel Policy v3")
    r = await dana.post(f"/api/documents/{v3}/status", json={"action": "approve"})
    assert r.status_code == 403
    payroll = await doc_id(sam, "Payroll Calendar 2027")
    detail = (await sam.get(f"/api/documents/{payroll}")).json()
    assert detail["can_change_status"] is True  # Sam owns it
    r = await sam.post(f"/api/documents/{payroll}/status", json={"action": "review"})
    assert r.status_code == 200
    assert r.json()["last_reviewed"] == date.today().isoformat()
    # A document the person can't see doesn't exist for them.
    r = await dana.post(f"/api/documents/{payroll}/status", json={"action": "approve"})
    assert r.status_code == 404


async def test_approving_a_draft_retires_the_previous_version_in_one_step(
    ready: dict[str, Any], client_for: MakeClient, db: AsyncSession
) -> None:
    alex = await client_for(ready["alex"])
    v2, v3 = await doc_id(alex, "Travel Policy v2"), await doc_id(alex, "Travel Policy v3")
    r = await alex.post(
        f"/api/documents/{v3}/status", json={"action": "approve", "note": "Signed off"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "approved"
    assert {m["title"]: m["is_current"] for m in body["family"]}["Travel Policy v3"] is True
    old = (await alex.get(f"/api/documents/{v2}")).json()
    assert old["status"] == "outdated"
    assert old["superseded_by"]["title"] == "Travel Policy v3"
    history = (await alex.get(f"/api/documents/{v2}/history")).json()
    assert history[0]["action"] == "superseded" and history[0]["actor_name"] == "Alex Morgan"
    actions = {
        a
        for (a,) in (
            await db.execute(select(DocumentStatusChange.action).order_by(DocumentStatusChange.id))
        ).all()
    }
    assert {"approve", "superseded"} <= actions
    # Answers now use v3, and never the retired v2.
    from tests.test_chat import ask, new_chat

    dana = await client_for(ready["dana"])
    out = await ask(dana, await new_chat(dana), "What's the current travel policy?")
    assert out["sources"][0]["title"] == "Travel Policy v3"
    assert "Travel Policy v2" not in [s["title"] for s in out["sources"]]


async def test_rejecting_needs_a_reason_and_leaves_the_queue(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    alex = await client_for(ready["alex"])
    v3 = await doc_id(alex, "Travel Policy v3")
    queue = (await alex.get("/api/approvals")).json()
    assert v3 in [d["id"] for d in queue["documents"] if d["reason"] == "awaiting_approval"]
    r = await alex.post(f"/api/documents/{v3}/status", json={"action": "reject"})
    assert r.status_code == 400
    r = await alex.post(
        f"/api/documents/{v3}/status", json={"action": "reject", "note": "Needs Finance sign-off"}
    )
    assert r.status_code == 200 and r.json()["status"] == "draft"
    queue = (await alex.get("/api/approvals")).json()
    assert v3 not in [d["id"] for d in queue["documents"]]
    history = (await alex.get(f"/api/documents/{v3}/history")).json()
    assert history[0]["note"] == "Needs Finance sign-off"


async def test_overdue_review_is_flagged_and_cleared_by_reviewing(
    ready: dict[str, Any], client_for: MakeClient, db: AsyncSession
) -> None:
    alex = await client_for(ready["alex"])
    desk = await doc_id(alex, "IT Help Desk")
    await db.execute(
        update(Document)
        .where(Document.title == "IT Help Desk")
        .values(last_reviewed=date.today() - timedelta(days=400))
    )
    await reconcile_flags(db)
    await db.commit()
    detail = (await alex.get(f"/api/documents/{desk}")).json()
    assert detail["review_overdue"] is True
    assert "review_overdue" in {f["kind"] for f in detail["flags"] if f["resolved_at"] is None}
    queue = (await alex.get("/api/approvals")).json()
    assert desk in [d["id"] for d in queue["documents"] if d["reason"] == "review_overdue"]
    r = await alex.post(f"/api/documents/{desk}/status", json={"action": "review"})
    assert r.json()["review_overdue"] is False
    async with db.begin():
        await reconcile_flags(db)
    detail = (await alex.get(f"/api/documents/{desk}")).json()
    assert "review_overdue" not in {f["kind"] for f in detail["flags"] if f["resolved_at"] is None}


async def test_an_approved_document_proposes_statuses_that_a_person_confirms(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    alex, dana = await client_for(ready["alex"]), await client_for(ready["dana"])
    operations = ready["operations"].id
    memo = (
        "# Memo: Supplier onboarding\n\n"
        "Effective today, use the Supplier Setup Form for every new supplier.\n"
    )
    r = await alex.post(
        "/api/admin/documents/upload",
        json={
            "filename": "supplier-memo.md",
            "content": memo,
            "access_group_id": str(operations),
            "owner_name": "Alex Morgan",
            "status": "approved",
        },
    )
    assert r.status_code == 201, r.text
    form = await doc_id(alex, "Supplier Setup Form")
    queue = (await alex.get("/api/approvals")).json()
    proposal = next(p for p in queue["proposals"] if p["document"]["id"] == form)
    assert proposal["proposed_status"] == "approved"
    assert proposal["evidence"]["title"] == "Memo: Supplier onboarding"
    assert "Supplier Setup Form" in proposal["evidence_text"]
    # Nothing changed by itself, and a Member who can't decide doesn't see it.
    assert (await alex.get(f"/api/documents/{form}")).json()["status"] == "unknown"
    assert (await dana.get("/api/approvals")).json()["proposals"] == []
    assert (
        await dana.post(f"/api/approvals/proposals/{proposal['id']}", json={"accept": True})
    ).status_code == 403
    r = await alex.post(f"/api/approvals/proposals/{proposal['id']}", json={"accept": True})
    assert r.status_code == 200
    detail = (await alex.get(f"/api/documents/{form}")).json()
    assert detail["status"] == "approved"
    history = (await alex.get(f"/api/documents/{form}/history")).json()
    assert history[0]["evidence"]["title"] == "Memo: Supplier onboarding"


def test_evidence_picks_the_most_specific_document() -> None:
    def doc(title: str, path: str, content: str = "") -> Document:
        return Document(
            title=title,
            source_path=path,
            content=content,
            family=family_key(title),
            content_hash="x",
            status="unknown",
        )

    old = doc("Vendor Onboarding Form", "Vendor_Onboarding_Form_2024.md")
    new = doc("Vendor Onboarding Form FINAL v2", "Vendor_Onboarding_Form_FINAL_v2.md")
    memo = doc(
        "Memo: Vendor Onboarding Update",
        "memo.md",
        "Effective today, all new vendors must be onboarded with the Vendor Onboarding Form "
        "FINAL v2.\n\nThe 2024 vendor onboarding form is retired.",
    )
    for d in (old, new, memo):
        d.id = __import__("uuid").uuid4()
    found = {(e.target.title, e.proposed) for e in find_evidence(memo, [old, new, memo])}
    assert found == {
        ("Vendor Onboarding Form FINAL v2", "approved"),
        ("Vendor Onboarding Form", "outdated"),
    }
