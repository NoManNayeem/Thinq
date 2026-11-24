from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict
from app.models import AuditEvent, Role
from app.services import users as user_service
from tests.conftest import PASSWORD, MakeClient, MakeUser

ADMIN_ENDPOINTS = [
    ("GET", "/api/admin/users"),
    ("POST", "/api/admin/users"),
    ("GET", "/api/admin/users/{nora}"),
    ("PATCH", "/api/admin/users/{nora}"),
    ("PUT", "/api/admin/users/{nora}/password"),
    ("POST", "/api/admin/users/{nora}/sessions/revoke"),
    ("PUT", "/api/admin/users/{nora}/groups/{finance}"),
    ("DELETE", "/api/admin/users/{paula}/groups/{finance}"),
    ("GET", "/api/admin/groups"),
    ("POST", "/api/admin/groups"),
    ("GET", "/api/admin/groups/{finance}"),
    ("PATCH", "/api/admin/groups/{finance}"),
    ("DELETE", "/api/admin/groups/{finance}"),
    ("GET", "/api/admin/audit"),
]


def _path(template: str, org: dict[str, Any]) -> str:
    return template.format(nora=org["nora"].id, paula=org["paula"].id, finance=org["finance"].id)


@pytest.mark.parametrize(("method", "template"), ADMIN_ENDPOINTS)
async def test_members_are_forbidden(
    method: str, template: str, client_for: MakeClient, org: dict[str, Any]
) -> None:
    client = await client_for(org["nora"])
    response = await client.request(method, _path(template, org), json={})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize(("method", "template"), ADMIN_ENDPOINTS)
async def test_anonymous_is_unauthenticated(
    method: str, template: str, anon: AsyncClient, org: dict[str, Any]
) -> None:
    response = await anon.request(method, _path(template, org), json={})
    assert response.status_code == 401


class TestList:
    async def test_lists_with_groups(self, client_for: MakeClient, org: dict[str, Any]) -> None:
        admin = await client_for(org["theo"])
        body = (await admin.get("/api/admin/users")).json()
        assert body["total"] == 3
        by_name = {u["name"]: u for u in body["items"]}
        assert [g["name"] for g in by_name["Paula Novak"]["groups"]] == ["Everyone", "Finance"]
        assert by_name["Theo Hart"]["role"] == "admin"

    async def test_filters(
        self, client_for: MakeClient, org: dict[str, Any], make_user: MakeUser
    ) -> None:
        await make_user("Old Timer", active=False)
        admin = await client_for(org["theo"])

        async def names(**params: str) -> list[str]:
            body = (await admin.get("/api/admin/users", params=params)).json()
            return [u["name"] for u in body["items"]]

        assert await names(q="finance") == ["Paula Novak"]  # matches title
        assert await names(role="admin") == ["Theo Hart"]
        assert await names(group_id=str(org["finance"].id)) == ["Paula Novak", "Theo Hart"]
        assert await names(status="inactive") == ["Old Timer"]
        assert (await names())[-1] == "Old Timer"  # inactive users sort last


class TestCreate:
    async def test_creates_user_with_groups(
        self, client_for: MakeClient, org: dict[str, Any], anon: AsyncClient
    ) -> None:
        admin = await client_for(org["theo"])
        response = await admin.post(
            "/api/admin/users",
            json={
                "email": "Sam@Example.com",
                "name": "Sam Ortiz",
                "title": "Operations Coordinator",
                "password": "welcome-to-thinq",
                "group_ids": [str(org["ops"].id)],
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["email"] == "sam@example.com"
        assert body["role"] == "member"
        assert [g["name"] for g in body["groups"]] == ["Everyone", "Ops"]
        login = await anon.post(
            "/api/auth/login", json={"email": "sam@example.com", "password": "welcome-to-thinq"}
        )
        assert login.status_code == 200

    async def test_duplicate_email(self, client_for: MakeClient, org: dict[str, Any]) -> None:
        admin = await client_for(org["theo"])
        response = await admin.post(
            "/api/admin/users", json={"email": "NORA@example.com", "name": "Nora Again"}
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "email_taken"

    async def test_rejects_bad_email(self, client_for: MakeClient, org: dict[str, Any]) -> None:
        admin = await client_for(org["theo"])
        response = await admin.post("/api/admin/users", json={"email": "nope", "name": "X"})
        assert response.status_code == 422


class TestImmediateAccessChanges:
    """Acceptance criterion: removing access applies on the user's very next request."""

    async def test_removing_a_group_applies_to_the_next_request(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        paula = await client_for(org["paula"])
        admin = await client_for(org["theo"])
        before = (await paula.get("/api/auth/me")).json()["user"]["groups"]
        assert "finance" in {g["slug"] for g in before}

        response = await admin.delete(
            f"/api/admin/users/{org['paula'].id}/groups/{org['finance'].id}"
        )
        assert response.status_code == 200
        assert [g["slug"] for g in response.json()["groups"]] == ["everyone"]

        after = (await paula.get("/api/auth/me")).json()["user"]["groups"]
        assert [g["slug"] for g in after] == ["everyone"]

    async def test_adding_a_group_applies_to_the_next_request(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        nora = await client_for(org["nora"])
        admin = await client_for(org["theo"])
        await admin.put(f"/api/admin/users/{org['nora'].id}/groups/{org['finance'].id}")
        groups = (await nora.get("/api/auth/me")).json()["user"]["groups"]
        assert {g["slug"] for g in groups} == {"everyone", "ops", "finance"}

    async def test_membership_changes_are_idempotent(
        self, client_for: MakeClient, org: dict[str, Any], db: AsyncSession
    ) -> None:
        admin = await client_for(org["theo"])
        url = f"/api/admin/users/{org['nora'].id}/groups/{org['ops'].id}"
        assert (await admin.put(url)).status_code == 200  # already a member
        assert (await admin.delete(url)).status_code == 200
        assert (await admin.delete(url)).status_code == 200  # already removed
        events = (
            await db.scalars(
                select(AuditEvent.action).where(AuditEvent.action.like("membership.%"))
            )
        ).all()
        assert events == ["membership.removed"]

    async def test_everyone_cannot_be_edited_per_user(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        admin = await client_for(org["theo"])
        groups = (await admin.get("/api/admin/groups")).json()
        everyone = next(g for g in groups if g["slug"] == "everyone")
        response = await admin.delete(f"/api/admin/users/{org['nora'].id}/groups/{everyone['id']}")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "system_group"

    async def test_deactivation_ends_sessions_immediately(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        nora = await client_for(org["nora"])
        admin = await client_for(org["theo"])
        response = await admin.patch(
            f"/api/admin/users/{org['nora'].id}", json={"is_active": False}
        )
        assert response.status_code == 200
        assert response.json()["active_session_count"] == 0
        assert (await nora.get("/api/auth/me")).status_code == 401

    async def test_password_reset_signs_user_out(
        self, client_for: MakeClient, org: dict[str, Any], anon: AsyncClient
    ) -> None:
        nora = await client_for(org["nora"])
        admin = await client_for(org["theo"])
        response = await admin.put(
            f"/api/admin/users/{org['nora'].id}/password",
            json={"new_password": "reset-by-admin-1"},
        )
        assert response.status_code == 204
        assert (await nora.get("/api/auth/me")).status_code == 401
        old = await anon.post(
            "/api/auth/login", json={"email": "nora@example.com", "password": PASSWORD}
        )
        assert old.status_code == 401

    async def test_revoke_sessions(self, client_for: MakeClient, org: dict[str, Any]) -> None:
        nora = await client_for(org["nora"])
        admin = await client_for(org["theo"])
        response = await admin.post(f"/api/admin/users/{org['nora'].id}/sessions/revoke")
        assert response.status_code == 200
        assert (await nora.get("/api/auth/me")).status_code == 401


class TestGuardRails:
    async def test_admin_cannot_change_own_role(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        admin = await client_for(org["theo"])
        response = await admin.patch(f"/api/admin/users/{org['theo'].id}", json={"role": "member"})
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "self_role_change"

    async def test_admin_cannot_deactivate_self(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        admin = await client_for(org["theo"])
        response = await admin.patch(
            f"/api/admin/users/{org['theo'].id}", json={"is_active": False}
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "self_deactivate"

    async def test_admin_can_demote_another_admin(
        self, client_for: MakeClient, org: dict[str, Any], make_user: MakeUser
    ) -> None:
        other = await make_user("Other Admin", role=Role.ADMIN.value)
        admin = await client_for(org["theo"])
        response = await admin.patch(f"/api/admin/users/{other.id}", json={"role": "member"})
        assert response.status_code == 200
        assert response.json()["role"] == "member"

    async def test_last_active_admin_is_protected(
        self, org: dict[str, Any], db: AsyncSession
    ) -> None:
        # Reachable only by a non-admin caller (e.g. a future automation); the API
        # itself always has the acting admin as a second admin.
        theo = await user_service.get_user(db, org["theo"].id)
        nora = await user_service.get_user(db, org["nora"].id)
        with pytest.raises(Conflict) as exc:
            await user_service.update_user(
                db,
                actor=nora,
                user=theo,
                name=None,
                title=None,
                title_set=False,
                role="member",
                is_active=None,
                ip_address=None,
            )
        assert exc.value.code == "last_admin"

    async def test_promoted_member_gains_admin_access_immediately(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        nora = await client_for(org["nora"])
        admin = await client_for(org["theo"])
        assert (await nora.get("/api/admin/users")).status_code == 403
        await admin.patch(f"/api/admin/users/{org['nora'].id}", json={"role": "admin"})
        assert (await nora.get("/api/admin/users")).status_code == 200


class TestAudit:
    async def test_changes_are_recorded_with_actor(
        self, client_for: MakeClient, org: dict[str, Any]
    ) -> None:
        admin = await client_for(org["theo"])
        await admin.delete(f"/api/admin/users/{org['paula'].id}/groups/{org['finance'].id}")
        await admin.patch(
            f"/api/admin/users/{org['nora'].id}", json={"role": "admin", "title": "Lead"}
        )

        events = (await admin.get("/api/admin/audit", params={"action": "membership."})).json()
        removed = events["items"][0]
        assert removed["action"] == "membership.removed"
        assert removed["actor_label"] == "theo@example.com"
        assert removed["target_label"] == "paula@example.com"
        assert removed["details"]["group"] == "Finance"
        assert removed["occurred_at"]

        role = (await admin.get("/api/admin/audit", params={"action": "user.role_changed"})).json()
        assert role["items"][0]["details"] == {"from": "member", "to": "admin"}
        updated = (await admin.get("/api/admin/audit", params={"action": "user.updated"})).json()
        assert updated["items"][0]["details"]["title"] == {
            "from": "Operations Coordinator",
            "to": "Lead",
        }

    async def test_cursor_pagination(self, client_for: MakeClient, org: dict[str, Any]) -> None:
        admin = await client_for(org["theo"])
        for title in ("A", "B", "C"):
            await admin.patch(f"/api/admin/users/{org['nora'].id}", json={"title": title})
        page1 = (
            await admin.get("/api/admin/audit", params={"action": "user.updated", "limit": 2})
        ).json()
        assert len(page1["items"]) == 2 and page1["next_cursor"]
        page2 = (
            await admin.get(
                "/api/admin/audit",
                params={"action": "user.updated", "limit": 2, "before": page1["next_cursor"]},
            )
        ).json()
        assert len(page2["items"]) == 1 and page2["next_cursor"] is None
        titles = [e["details"]["title"]["to"] for e in page1["items"] + page2["items"]]
        assert titles == ["C", "B", "A"]

    async def test_target_filter(self, client_for: MakeClient, org: dict[str, Any]) -> None:
        admin = await client_for(org["theo"])
        await admin.patch(f"/api/admin/users/{org['nora'].id}", json={"title": "X"})
        await admin.patch(f"/api/admin/users/{org['paula'].id}", json={"title": "Y"})
        body = (
            await admin.get("/api/admin/audit", params={"target_id": str(org["paula"].id)})
        ).json()
        assert {e["target_label"] for e in body["items"]} == {"paula@example.com"}


async def test_unknown_user_is_404(client_for: MakeClient, org: dict[str, Any]) -> None:
    admin = await client_for(org["theo"])
    response = await admin.get("/api/admin/users/00000000-0000-7000-8000-000000000000")
    assert response.status_code == 404


async def test_signed_in_user_password_not_exposed(
    client_for: MakeClient, org: dict[str, Any]
) -> None:
    admin = await client_for(org["theo"])
    body = (await admin.get(f"/api/admin/users/{org['nora'].id}")).json()
    assert "password_hash" not in body
    assert body["has_password"] is True
    assert PASSWORD not in str(body)
