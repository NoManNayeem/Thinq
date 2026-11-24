"""Feedback loop: flags reach the document owner (or Admins), resolutions are recorded, and the
person who flagged sees the outcome."""

from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import delete

from app.models import Membership
from tests.conftest import MakeClient
from tests.test_chat import ask, new_chat
from tests.test_trust import doc_id


@pytest.fixture
async def ready(seed_copy: Path, sample_org: dict[str, Any], scan: Any) -> dict[str, Any]:
    await scan(seed_copy)
    return sample_org


async def flag_answer(client: AsyncClient, question: str, reason: str = "outdated") -> str:
    chat = await new_chat(client)
    out = await ask(client, chat, question)
    r = await client.put(
        f"/api/chat/messages/{out['message_id']}/feedback",
        json={"rating": "down", "reason": reason, "comment": "Portal moved"},
    )
    assert r.status_code == 200
    return chat


async def test_answer_flag_reaches_the_cited_documents_owner(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    alex, riley = await client_for(ready["alex"]), await client_for(ready["riley"])
    await flag_answer(dana, "What's the current travel policy?")

    inbox = (await alex.get("/api/feedback/inbox")).json()
    item = next(i for i in inbox["items"] if i["document_title"] == "Travel Policy v2")
    assert item["assigned_to"] == "Alex Morgan"  # owner of the cited document
    assert item["question"] == "What's the current travel policy?"
    assert item["reporter_name"] == "Dana Lee" and item["reason"] == "outdated"
    assert item["can_resolve"] is True
    # Another Admin doesn't get items that have an owner.
    assert item["id"] not in [
        i["id"] for i in (await riley.get("/api/feedback/inbox")).json()["items"]
    ]
    # A Member can't see or resolve it.
    assert (await dana.get("/api/feedback/inbox")).json()["items"] == []
    r = await dana.post(f"/api/feedback/items/{item['id']}/resolve", json={"resolution": "fixed"})
    assert r.status_code == 404


async def test_no_owner_and_no_sources_go_to_admins(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, riley = await client_for(ready["dana"]), await client_for(ready["riley"])
    form = await doc_id(dana, "Supplier Setup Form")  # no owner recorded
    r = await dana.post(f"/api/documents/{form}/report", json={"reason": "outdated"})
    assert r.status_code == 201 and r.json()["assigned_to"] == "Admins"
    await flag_answer(dana, "Who won the 2018 football world cup?", reason="missing_source")
    titles = [
        (i["kind"], i["document_title"])
        for i in (await riley.get("/api/feedback/inbox")).json()["items"]
    ]
    assert ("document", "Supplier Setup Form") in titles
    assert ("answer", None) in titles  # a gap in the documentation


async def test_owner_who_lost_access_doesnt_get_the_item(
    ready: dict[str, Any], client_for: MakeClient, db: Any
) -> None:
    alex = await client_for(ready["alex"])
    payroll = await doc_id(alex, "Payroll Calendar 2027")  # owned by Sam
    await db.execute(
        delete(Membership).where(
            Membership.user_id == ready["sam"].id, Membership.group_id == ready["finance"].id
        )
    )
    await db.commit()
    r = await alex.post(f"/api/documents/{payroll}/report", json={"reason": "wrong"})
    assert r.json()["assigned_to"] == "Admins"


async def test_resolution_is_recorded_and_the_reporter_sees_it(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, alex = await client_for(ready["dana"]), await client_for(ready["alex"])
    chat = await flag_answer(dana, "What's the current travel policy?")
    item = next(
        i
        for i in (await alex.get("/api/feedback/inbox")).json()["items"]
        if i["document_title"] == "Travel Policy v2"
    )
    r = await alex.post(
        f"/api/feedback/items/{item['id']}/resolve",
        json={"resolution": "fixed", "note": "Updated the portal link."},
    )
    assert r.status_code == 200
    assert r.json()["state"] == "resolved" and r.json()["resolved_by_name"] == "Alex Morgan"

    mine = (await dana.get("/api/feedback/mine")).json()
    resolved = [m for m in mine if m["state"] == "resolved"]
    assert resolved and resolved[0]["resolution_note"] == "Updated the portal link."
    # The answer itself shows the outcome once every item on it is closed.
    for other in (await alex.get("/api/feedback/inbox")).json()["items"]:
        await alex.post(
            f"/api/feedback/items/{other['id']}/resolve", json={"resolution": "no_change"}
        )
    message = (await dana.get(f"/api/chat/conversations/{chat}")).json()["messages"][1]
    assert message["feedback"]["report"]["state"] == "resolved"
    # Closed items can't be resolved twice.
    r = await alex.post(f"/api/feedback/items/{item['id']}/resolve", json={"resolution": "fixed"})
    assert r.status_code == 400


async def test_resolving_can_mark_the_document_outdated(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, alex = await client_for(ready["dana"]), await client_for(ready["alex"])
    desk = await doc_id(dana, "IT Help Desk")
    item = (await dana.post(f"/api/documents/{desk}/report", json={"reason": "outdated"})).json()
    r = await alex.post(
        f"/api/feedback/items/{item['id']}/resolve",
        json={"resolution": "fixed", "mark_document_outdated": True, "note": "Replaced by wiki"},
    )
    assert r.json()["resolution"] == "marked_outdated"
    assert (await alex.get(f"/api/documents/{desk}")).json()["status"] == "outdated"
