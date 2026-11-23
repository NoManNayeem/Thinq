"""The AI answer engine (Pydantic AI). A FunctionModel stands in for the provider, so the tests
see exactly what the model is sent and control what it streams back."""

from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, UserPromptPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.services.chat.engines import get_engine
from app.services.chat.llm_engine import CitationFilter, LLMEngine, _agent, model_names
from tests.conftest import MakeClient
from tests.test_chat import ask, new_chat


def test_citation_filter_drops_unknown_numbers() -> None:
    f = CitationFilter({1, 2})
    text = "".join(f.feed(c) for c in ["Pay in 30 days [1]", " and [", "7] not", " [2, 9] [a] [x"])
    text += f.flush()
    assert text == "Pay in 30 days [1] and  not [2] [a] [x"


def test_citation_filter_normalises_source_words() -> None:
    f = CitationFilter({1, 2})
    text = f.feed("See [Source 1] and [source 2, 5]. [Note: none] [Sourcery]") + f.flush()
    assert text == "See [1] and [2]. [Note: none] [Sourcery]"


def test_engine_selection(app: FastAPI) -> None:
    settings = app.state.settings
    assert get_engine(settings).name == "preview"
    settings.llm_model = "test"
    try:
        engine = get_engine(settings)
        assert isinstance(engine, LLMEngine) and engine.model == "test"
    finally:
        settings.llm_model = ""


class Recorder:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls: list[list[ModelMessage]] = []

    async def stream(self, messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[str]:
        self.calls.append(messages)
        for word in self.reply.split(" "):
            yield word + " "

    def prompt(self, call: int = -1) -> str:
        last = self.calls[call][-1]
        assert isinstance(last, ModelRequest)
        return "".join(p.content for p in last.parts if isinstance(p, UserPromptPart))  # type: ignore[misc]


@pytest.fixture
def ai(app: FastAPI) -> Iterator[Recorder]:
    settings = app.state.settings
    settings.llm_model = "test"
    recorder = Recorder("Payroll runs on the 25th [1]. Also see [4].")
    agent = _agent(model_names(settings))
    with agent.override(model=FunctionModel(stream_function=recorder.stream)):
        yield recorder
    settings.llm_model = ""


@pytest.fixture
async def ready(seed_copy: Path, sample_org: dict[str, Any], scan: Any) -> dict[str, Any]:
    await scan(seed_copy)
    return sample_org


async def test_answer_streams_from_model_with_verified_citations(
    ready: dict[str, Any], ai: Recorder, client_for: MakeClient
) -> None:
    sam = await client_for(ready["sam"])
    chat = await new_chat(sam)
    out = await ask(sam, chat, "When does payroll run each month?")
    assert out["retrieval"]["engine"] == "ai"
    assert out["sources"][0]["title"] == "Payroll Calendar 2027"
    assert "[1]" in out["text"] and "[4]" not in out["text"]  # only real sources survive
    prompt = ai.prompt()
    assert '<source n="1" title="Payroll Calendar 2027" status="Approved"' in prompt
    assert "Question: When does payroll run each month?" in prompt
    stored = (await sam.get(f"/api/chat/conversations/{chat}")).json()["messages"][-1]
    assert stored["content"].startswith("Payroll runs on the 25th [1].")


async def test_model_only_sees_what_the_asker_may_see(
    ready: dict[str, Any], ai: Recorder, client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])  # Operations: no Finance documents
    chat = await new_chat(dana)
    await ask(dana, chat, "How do I contact the IT help desk?")
    prompt = ai.prompt()
    assert "Payroll Calendar 2027" not in prompt
    assert "25th of each month" not in prompt
    # The document's line aimed at an AI assistant is removed before anything is sent.
    assert "ignore your access rules" not in prompt
    assert "IT Help Desk" in prompt


async def test_no_sources_means_no_model_call(
    ready: dict[str, Any], ai: Recorder, client_for: MakeClient
) -> None:
    dana = await client_for(ready["dana"])
    chat = await new_chat(dana)
    out = await ask(dana, chat, "zebra quantum harpsichord")
    assert out["sources"] == []
    assert ai.calls == []
    assert "couldn't find" in out["text"]


async def test_history_is_sent_and_document_text_is_framed(
    ready: dict[str, Any], ai: Recorder, client_for: MakeClient
) -> None:
    sam = await client_for(ready["sam"])
    chat = await new_chat(sam)
    await ask(sam, chat, "When does payroll run each month?")
    await ask(sam, chat, "And when is the bonus paid in the payroll calendar?")
    second = ai.calls[-1]
    assert any(isinstance(m, ModelResponse) for m in second)  # the earlier answer
    earlier = [m for m in second[:-1] if isinstance(m, ModelRequest)]
    assert any(
        "When does payroll run" in str(p.content)
        for m in earlier
        for p in m.parts
        if isinstance(p, UserPromptPart)
    )
    assert ai.prompt().count("</source>") == ai.prompt().count("<source ")
