"""Answer engines. An engine turns a question plus access-filtered passages into an answer.

Engines never fetch documents themselves: they receive only what ``retrieve`` returned for the
person asking, so they can't see more than that person could.
"""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings
from app.models import DocumentStatus
from app.services.chat.retrieval import RetrievalResult

STATUS_LABEL = {
    "approved": "Approved",
    "draft": "Draft",
    "reference": "Reference",
    "unknown": "status unknown",
    "outdated": "Outdated",
}


@dataclass(frozen=True)
class Notice:
    kind: str
    message: str


class AnswerEngine(Protocol):
    name: str
    model: str | None

    def notices(self, result: RetrievalResult) -> list[Notice]: ...

    def stream(
        self, question: str, result: RetrievalResult, history: list[tuple[str, str]]
    ) -> AsyncIterator[str]: ...


def common_notices(result: RetrievalResult) -> list[Notice]:
    notices: list[Notice] = []
    statuses = {p.document.status for p in result.passages}
    if DocumentStatus.DRAFT.value in statuses:
        notices.append(Notice("draft", "Includes a draft that isn't approved for use yet."))
    if result.draft_matches:
        names = ", ".join(sorted(d.title for d in result.draft_matches))
        notices.append(
            Notice("draft_also", f"A draft also matched but isn't approved for use yet: {names}.")
        )
    if DocumentStatus.UNKNOWN.value in statuses:
        notices.append(
            Notice("unknown_status", "Includes a document nobody has marked as approved.")
        )
    if result.outdated_matches:
        names = ", ".join(sorted(d.title for d in result.outdated_matches))
        notices.append(Notice("outdated_excluded", f"Left out an outdated version: {names}."))
    return notices


class PreviewEngine:
    """No AI model: answers with the most trusted matching excerpts, clearly labelled."""

    name = "preview"
    model: str | None = None

    def __init__(self, delay_s: float = 0.012) -> None:
        self.delay_s = delay_s

    def notices(self, result: RetrievalResult) -> list[Notice]:
        return common_notices(result)

    def compose(self, result: RetrievalResult) -> str:
        if not result.passages:
            return (
                "I couldn't find anything about that in the documents you can access. "
                "If it should be documented, ask the owner of the related process, "
                "or try different words."
            )
        top, *rest = result.passages
        lines = [
            f"The most relevant document you can access is **{top.document.title}** "
            f"({STATUS_LABEL.get(top.document.status, top.document.status)}) [1]."
        ]
        if rest:
            also = "; ".join(
                f"**{p.document.title}** "
                f"({STATUS_LABEL.get(p.document.status, p.document.status)}) [{i}]"
                for i, p in enumerate(rest, start=2)
            )
            lines.append(f"Also related: {also}.")
        lines.append(
            "\nThinq is in preview mode, so this is a list of excerpts "
            "rather than a written answer. "
            "Open a source to read it in full."
        )
        return " ".join(lines[:-1]) + "\n" + lines[-1]

    async def stream(
        self, question: str, result: RetrievalResult, history: list[tuple[str, str]]
    ) -> AsyncIterator[str]:
        text = self.compose(result)
        for word in text.split(" "):
            yield word + " "
            if self.delay_s:
                await asyncio.sleep(self.delay_s)


def get_engine(settings: Settings) -> AnswerEngine:
    """The AI engine when a model is configured, otherwise the preview engine."""
    if settings.llm_model.strip():
        from app.services.chat.llm_engine import LLMEngine

        return LLMEngine(settings)
    return PreviewEngine()
