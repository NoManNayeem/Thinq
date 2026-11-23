"""The brief's core rule: a user may see a document only if they belong to its access group."""

from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import MakeClient


async def _ids(client: AsyncClient) -> dict[str, str]:
    body = (await client.get("/api/documents", params={"limit": 500})).json()
    return {d["source_path"]: d["id"] for d in body["items"]}


@pytest.fixture
async def imported(
    seed_copy: Path, sample_org: dict[str, Any], scan: Any, client_for: MakeClient
) -> dict[str, str]:
    await scan(seed_copy)
    return await _ids(await client_for(sample_org["alex"]))


async def test_members_see_only_their_groups(
    imported: dict[str, str], sample_org: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await _ids(await client_for(sample_org["dana"]))
    assert "Payroll_Calendar_2027.md" not in dana  # Finance only
    assert "travel policy (1).md" not in dana  # unregistered: Admins only
    assert "Supplier_Setup_Form.md" in dana  # Operations
    assert "Travel_Policy_v2.md" in dana  # Everyone

    sam = await _ids(await client_for(sample_org["sam"]))
    assert "Payroll_Calendar_2027.md" in sam
    assert "Supplier_Setup_Form.md" not in sam


@pytest.mark.parametrize(
    "path",
    ["/api/documents/{id}", "/api/documents/{id}/versions", "/api/documents/{id}/versions/1"],
)
async def test_hidden_documents_are_not_found(
    path: str, imported: dict[str, str], sample_org: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(sample_org["dana"])
    hidden = await dana.get(path.format(id=imported["Payroll_Calendar_2027.md"]))
    missing = await dana.get(path.format(id="00000000-0000-7000-8000-000000000000"))
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json() == missing.json()  # indistinguishable from a document that doesn't exist


async def test_search_never_reveals_hidden_content(
    imported: dict[str, str], sample_org: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(sample_org["dana"])
    sam = await client_for(sample_org["sam"])
    phrase = "Bonus payments"  # only in the Finance payroll calendar
    assert (await dana.get("/api/documents", params={"q": phrase})).json()["total"] == 0
    found = (await sam.get("/api/documents", params={"q": phrase})).json()
    assert [d["source_path"] for d in found["items"]] == ["Payroll_Calendar_2027.md"]
    assert "Bonus payments" in found["items"][0]["match"]


async def test_losing_a_group_applies_to_the_next_request(
    imported: dict[str, str], sample_org: dict[str, Any], client_for: MakeClient
) -> None:
    payroll = imported["Payroll_Calendar_2027.md"]
    sam = await client_for(sample_org["sam"])
    admin = await client_for(sample_org["alex"])
    assert (await sam.get(f"/api/documents/{payroll}")).status_code == 200

    await admin.delete(f"/api/admin/users/{sample_org['sam'].id}/groups/{sample_org['finance'].id}")

    assert (await sam.get(f"/api/documents/{payroll}")).status_code == 404
    assert "Payroll_Calendar_2027.md" not in await _ids(sam)


async def test_admin_role_grants_no_document_access(
    imported: dict[str, str], sample_org: dict[str, Any], client_for: MakeClient
) -> None:
    riley = await client_for(sample_org["riley"])  # Admin, but only in Operations
    assert (
        await riley.get(f"/api/documents/{imported['Payroll_Calendar_2027.md']}")
    ).status_code == 404
    patch = await riley.patch(
        f"/api/admin/documents/{imported['Payroll_Calendar_2027.md']}", json={"title": "Peek"}
    )
    assert patch.status_code == 404
    # …but Admins can triage documents nobody has been given access to yet.
    assert (
        await riley.get(f"/api/documents/{imported['travel policy (1).md']}")
    ).status_code == 200


async def test_members_get_no_flag_details(
    imported: dict[str, str], sample_org: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(sample_org["dana"])
    listing = (await dana.get("/api/documents")).json()
    assert {d["open_flag_count"] for d in listing["items"]} == {None}
    detail = (await dana.get(f"/api/documents/{imported['IT_Help_Desk.md']}")).json()
    assert detail["flags"] is None

    alex = await client_for(sample_org["alex"])
    detail = (await alex.get(f"/api/documents/{imported['IT_Help_Desk.md']}")).json()
    assert [f["kind"] for f in detail["flags"]] == ["ai_instruction"]


async def test_listing_details(
    imported: dict[str, str], sample_org: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(sample_org["dana"])
    body = (await dana.get("/api/documents")).json()
    assert body["status_counts"] == {
        "approved": 2,
        "draft": 1,
        "outdated": 1,
        "reference": 1,
        "unknown": 1,
    }
    drafts = (await dana.get("/api/documents", params={"status": "draft"})).json()
    assert [d["title"] for d in drafts["items"]] == ["Travel Policy v3"]
    v2 = (await dana.get(f"/api/documents/{imported['Travel_Policy_v2.md']}")).json()
    assert v2["owner"] == {
        "name": "Alex Morgan",
        "user_id": str(sample_org["alex"].id),
        "has_account": True,
    }
    assert v2["access_group"]["slug"] == "everyone"
    assert v2["audience_count"] == 4
    assert v2["content"].startswith("# Travel Policy (v2)")
