from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import MakeClient


@pytest.fixture
async def ctx(
    seed_copy: Path, sample_org: dict[str, Any], scan: Any, client_for: MakeClient
) -> dict[str, Any]:
    await scan(seed_copy)
    alex = await client_for(sample_org["alex"])
    items = (await alex.get("/api/documents", params={"limit": 500})).json()["items"]
    return {
        **sample_org,
        "admin": alex,
        "ids": {d["source_path"]: d["id"] for d in items},
        "seed": seed_copy,
    }


async def _flags(client: AsyncClient, doc_id: str) -> dict[str, dict[str, Any]]:
    body = (await client.get(f"/api/documents/{doc_id}")).json()
    return {f["kind"]: f for f in body["flags"] if f["resolved_at"] is None}


async def test_attention_queue_puts_critical_first(ctx: dict[str, Any]) -> None:
    items = (await ctx["admin"].get("/api/admin/documents/attention")).json()
    assert items[0]["source_path"] == "travel policy (1).md"
    assert items[0]["flags"][0]["kind"] == "unregistered"
    assert {i["source_path"] for i in items} == {
        "travel policy (1).md",
        "Supplier_Setup_Form.md",
        "Travel_Policy_2023.md",
        "IT_Help_Desk.md",
        "Operations_Weekly_2026-11-02.md",
    }


async def test_registering_a_file(ctx: dict[str, Any], client_for: MakeClient) -> None:
    doc = ctx["ids"]["travel policy (1).md"]
    dana = await client_for(ctx["dana"])
    assert (await dana.get(f"/api/documents/{doc}")).status_code == 404

    response = await ctx["admin"].post(
        f"/api/admin/documents/{doc}/register",
        json={
            "title": "Travel Policy v2 (copy)",
            "access_group_id": str(ctx["operations"].id),
            "owner_name": "dana lee",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_registered"] and body["access_group"]["name"] == "Operations"
    assert body["owner"]["user_id"] == str(ctx["dana"].id)  # matched case-insensitively
    open_kinds = {f["kind"] for f in body["flags"] if f["resolved_at"] is None}
    assert "unregistered" not in open_kinds and "likely_duplicate" in open_kinds

    assert (await dana.get(f"/api/documents/{doc}")).status_code == 200
    again = await ctx["admin"].post(
        f"/api/admin/documents/{doc}/register",
        json={"title": "x", "access_group_id": str(ctx["operations"].id)},
    )
    assert again.status_code == 409


async def test_changing_access_applies_immediately_and_is_audited(
    ctx: dict[str, Any], client_for: MakeClient
) -> None:
    doc = ctx["ids"]["Supplier_Setup_Form.md"]
    dana = await client_for(ctx["dana"])
    assert (await dana.get(f"/api/documents/{doc}")).status_code == 200

    response = await ctx["admin"].patch(
        f"/api/admin/documents/{doc}", json={"access_group_id": str(ctx["finance"].id)}
    )
    assert response.status_code == 200
    assert (await dana.get(f"/api/documents/{doc}")).status_code == 404

    events = (
        await ctx["admin"].get("/api/admin/audit", params={"action": "document.access_changed"})
    ).json()
    assert events["items"][0]["details"] == {"from": "Operations", "to": "Finance"}
    assert events["items"][0]["target_label"] == "Supplier Setup Form"

    cleared = await ctx["admin"].patch(
        f"/api/admin/documents/{doc}", json={"access_group_id": None}
    )
    assert cleared.status_code == 400


async def test_assigning_an_owner_resolves_the_flag(ctx: dict[str, Any]) -> None:
    doc = ctx["ids"]["Travel_Policy_2023.md"]
    assert "missing_owner" in await _flags(ctx["admin"], doc)
    response = await ctx["admin"].patch(
        f"/api/admin/documents/{doc}", json={"owner_user_id": str(ctx["alex"].id)}
    )
    assert response.json()["owner"]["name"] == "Alex Morgan"
    assert "missing_owner" not in await _flags(ctx["admin"], doc)


async def test_dismissed_flags_stay_dismissed(ctx: dict[str, Any], scan: Any) -> None:
    doc = ctx["ids"]["Operations_Weekly_2026-11-02.md"]
    flag = (await _flags(ctx["admin"], doc))["owner_is_team"]
    response = await ctx["admin"].post(
        f"/api/admin/documents/{doc}/flags/{flag['id']}/dismiss",
        json={"note": "The ops team shares ownership."},
    )
    assert response.status_code == 200
    await scan(ctx["seed"])
    assert "owner_is_team" not in await _flags(ctx["admin"], doc)
    events = (
        await ctx["admin"].get("/api/admin/audit", params={"action": "document.flag_dismissed"})
    ).json()
    assert events["items"][0]["details"]["note"] == "The ops team shares ownership."


async def test_access_flags_cannot_be_dismissed(ctx: dict[str, Any]) -> None:
    doc = ctx["ids"]["travel policy (1).md"]
    flag = (await _flags(ctx["admin"], doc))["unregistered"]
    response = await ctx["admin"].post(
        f"/api/admin/documents/{doc}/flags/{flag['id']}/dismiss", json={"note": "nah"}
    )
    assert response.status_code == 409


async def test_scan_endpoint(ctx: dict[str, Any]) -> None:
    response = await ctx["admin"].post("/api/admin/documents/scan")
    assert response.status_code == 200
    assert response.json()["stats"]["unchanged"] == 8
    latest = (await ctx["admin"].get("/api/admin/documents/scans/latest")).json()
    assert latest["id"] == response.json()["id"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/admin/documents/attention"),
        ("POST", "/api/admin/documents/scan"),
        ("PATCH", "/api/admin/documents/{id}"),
        ("POST", "/api/admin/documents/{id}/register"),
    ],
)
async def test_members_cannot_use_admin_endpoints(
    method: str, path: str, ctx: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ctx["dana"])
    response = await dana.request(
        method, path.format(id=ctx["ids"]["Travel_Policy_v2.md"]), json={}
    )
    assert response.status_code == 403
