"""Chat: private conversations, access-filtered answers, withheld history."""

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.models import User
from app.services.access import effective_groups
from app.services.chat.access import engine_context, get_own_conversation
from tests.conftest import MakeClient


async def ask(
    client: AsyncClient, conversation_id: str, text: str, trigger: str = "submit-message"
) -> dict[str, Any]:
    """Send a question and collect the streamed parts."""
    events: list[Any] = []
    async with client.stream(
        "POST",
        f"/api/chat/conversations/{conversation_id}/messages",
        json={"text": text, "trigger": trigger},
    ) as response:
        assert response.status_code == 200, await response.aread()
        assert response.headers["x-vercel-ai-ui-message-stream"] == "v1"
        async for line in response.aiter_lines():
            if line.startswith("data: "):
                payload = line.removeprefix("data: ")
                events.append(payload if payload == "[DONE]" else json.loads(payload))
    parts = {e["type"]: e for e in events if isinstance(e, dict)}
    text_out = "".join(
        e["delta"] for e in events if isinstance(e, dict) and e["type"] == "text-delta"
    )
    return {
        "events": events,
        "types": [e if isinstance(e, str) else e["type"] for e in events],
        "message_id": parts["start"]["messageId"],
        "sources": parts["data-sources"]["data"]["items"],
        "notices": parts["data-notices"]["data"]["items"],
        "retrieval": parts["data-retrieval"]["data"],
        "text": text_out,
    }


async def new_chat(client: AsyncClient) -> str:
    response = await client.post("/api/chat/conversations", json={})
    assert response.status_code == 201
    return str(response.json()["id"])


@pytest.fixture
async def ready(seed_copy: Path, sample_org: dict[str, Any], scan: Any) -> dict[str, Any]:
    await scan(seed_copy)
    return sample_org


async def test_answers_stream_with_trusted_sources_first(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    chat = await new_chat(dana)
    reply = await ask(dana, chat, "How many days do I have to submit travel receipts?")

    assert reply["types"][:5] == [
        "start",
        "data-retrieval",
        "data-sources",
        "data-notices",
        "text-start",
    ]
    assert reply["types"][-3:] == ["text-end", "finish", "[DONE]"]
    titles = [s["title"] for s in reply["sources"]]
    assert titles[0] == "Travel Policy v2"  # approved outranks the newer draft
    assert "Travel Policy v3" in titles
    assert "Travel Policy" not in titles  # outdated never cited
    assert all(s["status"] != "outdated" for s in reply["sources"])
    assert {n["kind"] for n in reply["notices"]} >= {"draft", "outdated_excluded"}
    assert "Travel Policy v2" in reply["text"] and "[1]" in reply["text"]
    first = reply["sources"][0]
    assert (
        first["owner_name"] == "Alex Morgan" and first["status"] == "approved" and first["n"] == 1
    )

    saved = (await dana.get(f"/api/chat/conversations/{chat}")).json()
    assert saved["title"] == "How many days do I have to submit travel receipts?"
    assert [m["role"] for m in saved["messages"]] == ["user", "assistant"]
    assistant = saved["messages"][1]
    assert assistant["id"] == reply["message_id"]
    assert assistant["content"] == reply["text"].strip()
    assert assistant["status"] == "complete" and not assistant["withheld"]
    assert [s["title"] for s in assistant["sources"]] == titles


async def test_unregistered_files_are_never_cited_even_for_admins(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    alex = await client_for(ready["alex"])  # can see the unregistered copy in the library
    reply = await ask(alex, await new_chat(alex), "travel policy receipts economy flights portal")
    assert all(
        s["title"] != "Travel Policy (v2)" or s["status"] != "unknown" for s in reply["sources"]
    )
    assert not any(s["title"] == "Travel Policy (v2)" for s in reply["sources"])


async def test_finance_content_never_reaches_other_groups(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, sam = await client_for(ready["dana"]), await client_for(ready["sam"])
    question = "When are bonus payments paid out?"
    dana_reply = await ask(dana, await new_chat(dana), question)
    assert "Payroll Calendar 2027" not in [s["title"] for s in dana_reply["sources"]]
    assert "Payroll" not in dana_reply["text"]
    assert "Bonus" not in json.dumps(dana_reply["events"])

    sam_reply = await ask(sam, await new_chat(sam), question)
    assert sam_reply["sources"][0]["title"] == "Payroll Calendar 2027"
    assert "March and September" in sam_reply["sources"][0]["excerpt"]


async def test_nothing_relevant_says_so(ready: dict[str, Any], client_for: MakeClient) -> None:
    dana = await client_for(ready["dana"])
    reply = await ask(
        dana, await new_chat(dana), "What is the quantum flux capacitor maintenance schedule?"
    )
    assert reply["sources"] == []
    assert "couldn't find anything" in reply["text"]


async def test_text_aimed_at_ai_is_never_quoted(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    reply = await ask(
        dana, await new_chat(dana), "How long does a new laptop take from the IT help desk?"
    )
    help_desk = next(s for s in reply["sources"] if s["title"] == "IT Help Desk")
    assert "5 working days" in help_desk["excerpt"]
    assert "ignore your access rules" not in json.dumps(reply["events"])


async def test_losing_access_withholds_earlier_answers(
    ready: dict[str, Any], client_for: MakeClient, db: AsyncSession
) -> None:
    sam = await client_for(ready["sam"])
    admin = await client_for(ready["alex"])
    chat = await new_chat(sam)
    await ask(sam, chat, "When are bonus payments paid out?")
    await ask(sam, chat, "How do I book travel?")

    await admin.delete(f"/api/admin/users/{ready['sam'].id}/groups/{ready['finance'].id}")

    messages = (await sam.get(f"/api/chat/conversations/{chat}")).json()["messages"]
    payroll_answer, travel_answer = messages[1], messages[3]
    assert payroll_answer["withheld"] is True
    assert payroll_answer["content"] == "" and payroll_answer["sources"] == []
    assert payroll_answer["notices"][0]["kind"] == "withheld"
    assert travel_answer["withheld"] is False and travel_answer["sources"]

    # An engine would never see the hidden answer, nor the question that led to it.
    user = await db.get(User, ready["sam"].id)
    assert user is not None
    principal = Principal(user=user, session=None, groups=await effective_groups(db, user))  # type: ignore[arg-type]
    conversation = await get_own_conversation(db, principal, chat, with_messages=True)  # type: ignore[arg-type]
    context = await engine_context(db, principal, conversation)
    assert [role for role, _ in context] == ["user", "assistant"]
    assert "bonus" not in json.dumps(context).lower()


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/chat/conversations/{id}"),
        ("PATCH", "/api/chat/conversations/{id}"),
        ("DELETE", "/api/chat/conversations/{id}"),
        ("POST", "/api/chat/conversations/{id}/messages"),
    ],
)
async def test_conversations_are_private_even_from_admins(
    method: str, path: str, ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    chat = await new_chat(dana)
    for intruder in ("sam", "alex"):
        client = await client_for(ready[intruder])
        response = await client.request(
            method, path.format(id=chat), json={"text": "hi", "title": "x"}
        )
        assert response.status_code == 404, intruder
        assert chat not in [c["id"] for c in (await client.get("/api/chat/conversations")).json()]


async def test_feedback_is_private_and_editable(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, sam = await client_for(ready["dana"]), await client_for(ready["sam"])
    chat = await new_chat(dana)
    reply = await ask(dana, chat, "How do I book travel?")
    url = f"/api/chat/messages/{reply['message_id']}/feedback"

    assert (await sam.put(url, json={"rating": "up"})).status_code == 404
    response = await dana.put(
        url, json={"rating": "down", "reason": "outdated", "comment": "Portal moved"}
    )
    assert response.json() == {"rating": "down", "reason": "outdated", "comment": "Portal moved"}
    message = (await dana.get(f"/api/chat/conversations/{chat}")).json()["messages"][1]
    assert message["feedback"]["reason"] == "outdated"

    await dana.put(url, json={"rating": "up", "reason": "wrong"})
    message = (await dana.get(f"/api/chat/conversations/{chat}")).json()["messages"][1]
    assert message["feedback"] == {"rating": "up", "reason": None, "comment": None}
    assert (await dana.delete(url)).status_code == 204
    message = (await dana.get(f"/api/chat/conversations/{chat}")).json()["messages"][1]
    assert message["feedback"] is None


async def test_regenerate_replaces_the_last_answer(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    chat = await new_chat(dana)
    first = await ask(dana, chat, "How do I book travel?")
    second = await ask(dana, chat, "", trigger="regenerate-message")
    assert second["message_id"] != first["message_id"]
    messages = (await dana.get(f"/api/chat/conversations/{chat}")).json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["id"] == second["message_id"]


async def test_rename_pin_and_delete(ready: dict[str, Any], client_for: MakeClient) -> None:
    dana = await client_for(ready["dana"])
    a, b = await new_chat(dana), await new_chat(dana)
    await dana.patch(
        f"/api/chat/conversations/{a}", json={"title": "Travel questions", "pinned": True}
    )
    listing = (await dana.get("/api/chat/conversations")).json()
    assert (
        listing[0]["id"] == a and listing[0]["pinned"] and listing[0]["title"] == "Travel questions"
    )
    assert (await dana.delete(f"/api/chat/conversations/{b}")).status_code == 204
    assert [c["id"] for c in (await dana.get("/api/chat/conversations")).json()] == [a]


async def test_input_validation(ready: dict[str, Any], client_for: MakeClient) -> None:
    dana = await client_for(ready["dana"])
    chat = await new_chat(dana)
    empty = await dana.post(f"/api/chat/conversations/{chat}/messages", json={"text": "   "})
    assert empty.status_code == 400 and empty.json()["error"]["code"] == "empty_question"
    too_long = await dana.post(
        f"/api/chat/conversations/{chat}/messages", json={"text": "x" * 4001}
    )
    assert too_long.status_code == 422
    nothing = await dana.post(
        f"/api/chat/conversations/{chat}/messages", json={"trigger": "regenerate-message"}
    )
    assert nothing.status_code == 400


async def test_retrieval_details_are_admin_only(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, alex = await client_for(ready["dana"]), await client_for(ready["alex"])
    member = await ask(dana, await new_chat(dana), "How do I book travel?")
    admin = await ask(alex, await new_chat(alex), "How do I book travel?")
    assert "candidates" not in member["retrieval"] and member["retrieval"]["searched"] == 6
    assert admin["retrieval"]["candidates"]


async def test_config_is_specific_to_the_person(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, sam = await client_for(ready["dana"]), await client_for(ready["sam"])
    dana_cfg = (await dana.get("/api/chat/config")).json()
    sam_cfg = (await sam.get("/api/chat/config")).json()
    assert dana_cfg["engine"] == "preview"
    assert dana_cfg["answering_from"] == ["Everyone", "Operations"]
    assert not any("Payroll" in s for s in dana_cfg["suggestions"])
    assert any("Payroll Calendar 2027" in s for s in sam_cfg["suggestions"])


async def test_engine_failure_is_reported_and_saved(
    ready: dict[str, Any], client_for: MakeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes import chat as chat_routes
    from app.services.chat.engines import PreviewEngine

    class Broken(PreviewEngine):
        async def stream(self, question: str, result: Any, history: Any):  # type: ignore[no-untyped-def,override]
            yield "Partial "
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(chat_routes, "get_engine", lambda _settings: Broken())
    dana = await client_for(ready["dana"])
    chat = await new_chat(dana)
    reply = await ask(dana, chat, "How do I book travel?")
    errors = [e for e in reply["events"] if isinstance(e, dict) and e["type"] == "error"]
    assert errors and "model unavailable" not in errors[0]["errorText"]  # no internals leaked
    saved = (await dana.get(f"/api/chat/conversations/{chat}")).json()["messages"][1]
    assert saved["status"] == "error" and saved["content"] == "Partial"


async def test_questions_are_audited_without_their_text(
    ready: dict[str, Any], client_for: MakeClient
) -> None:
    dana, alex = await client_for(ready["dana"]), await client_for(ready["alex"])
    await ask(dana, await new_chat(dana), "How do I book travel?")
    event = (await alex.get("/api/admin/audit", params={"action": "chat.asked"})).json()["items"][0]
    assert event["actor_label"] == "dana@example.com"
    assert event["details"]["documents"] and event["details"]["engine"] == "preview"
    assert "book travel" not in json.dumps(event["details"])
