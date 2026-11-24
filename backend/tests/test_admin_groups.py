from typing import Any

from tests.conftest import MakeClient, MakeUser


async def test_lists_groups_with_member_counts(
    client_for: MakeClient, org: dict[str, Any], make_user: MakeUser
) -> None:
    await make_user("Former Staff", active=False, groups=[org["ops"]])
    admin = await client_for(org["theo"])
    groups = (await admin.get("/api/admin/groups")).json()
    assert [(g["name"], g["member_count"]) for g in groups] == [
        ("Everyone", 3),  # system group first; inactive users not counted
        ("Finance", 2),
        ("Ops", 2),
    ]


async def test_create_rename_and_delete(client_for: MakeClient, org: dict[str, Any]) -> None:
    admin = await client_for(org["theo"])
    created = await admin.post(
        "/api/admin/groups", json={"name": "Field Operations", "description": "Inspections"}
    )
    assert created.status_code == 201
    group = created.json()
    assert group["slug"] == "field-operations"

    duplicate = await admin.post("/api/admin/groups", json={"name": "field operations"})
    assert duplicate.status_code == 409

    renamed = await admin.patch(f"/api/admin/groups/{group['id']}", json={"name": "Field Ops"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Field Ops"
    assert renamed.json()["slug"] == "field-operations"  # slugs are stable identifiers

    assert (await admin.delete(f"/api/admin/groups/{group['id']}")).status_code == 204
    assert (await admin.get(f"/api/admin/groups/{group['id']}")).status_code == 404


async def test_deleting_a_group_removes_access_immediately(
    client_for: MakeClient, org: dict[str, Any]
) -> None:
    paula = await client_for(org["paula"])
    admin = await client_for(org["theo"])
    assert (await admin.delete(f"/api/admin/groups/{org['finance'].id}")).status_code == 204
    groups = (await paula.get("/api/auth/me")).json()["user"]["groups"]
    assert [g["slug"] for g in groups] == ["everyone"]


async def test_group_detail_lists_members_with_who_added_them(
    client_for: MakeClient, org: dict[str, Any]
) -> None:
    admin = await client_for(org["theo"])
    await admin.put(f"/api/admin/users/{org['nora'].id}/groups/{org['finance'].id}")
    detail = (await admin.get(f"/api/admin/groups/{org['finance'].id}")).json()
    members = {m["name"]: m for m in detail["members"]}
    assert set(members) == {"Nora Reyes", "Paula Novak", "Theo Hart"}
    assert members["Nora Reyes"]["added_by"] == "Theo Hart"
    assert members["Paula Novak"]["added_by"] is None  # seeded
    assert detail["member_count"] == 3


async def test_everyone_is_protected(client_for: MakeClient, org: dict[str, Any]) -> None:
    admin = await client_for(org["theo"])
    everyone = next(
        g for g in (await admin.get("/api/admin/groups")).json() if g["slug"] == "everyone"
    )
    assert (
        await admin.patch(f"/api/admin/groups/{everyone['id']}", json={"name": "All"})
    ).status_code == 409
    assert (await admin.delete(f"/api/admin/groups/{everyone['id']}")).status_code == 409
    edit = await admin.patch(
        f"/api/admin/groups/{everyone['id']}", json={"description": "Every employee."}
    )
    assert edit.status_code == 200
    detail = (await admin.get(f"/api/admin/groups/{everyone['id']}")).json()
    assert len(detail["members"]) == 3
    assert detail["description"] == "Every employee."


async def test_bangla_names_are_supported(client_for: MakeClient, org: dict[str, Any]) -> None:
    admin = await client_for(org["theo"])
    group = await admin.post("/api/admin/groups", json={"name": "অর্থ ও হিসাব বিভাগ"})
    assert group.status_code == 201
    body = group.json()
    assert body["name"] == "অর্থ ও হিসাব বিভাগ"
    assert body["slug"]  # an ASCII-safe fallback slug is generated
    second = await admin.post("/api/admin/groups", json={"name": "মানব সম্পদ"})
    assert second.status_code == 201
    assert second.json()["slug"] != body["slug"]

    user = await admin.post(
        "/api/admin/users",
        json={"name": "নাদিয়া রহমান", "email": "nora.bn@example.com", "group_ids": [body["id"]]},
    )
    assert user.status_code == 201
    assert user.json()["name"] == "নাদিয়া রহমান"
    assert "অর্থ ও হিসাব বিভাগ" in [g["name"] for g in user.json()["groups"]]
