"""Simple, deterministic retrieval over the documents a person can see.

Lexical scoring with IDF weights over document blocks, optionally fused with semantic hits from
the Cognee knowledge layer, then a trust weighting so approved content outranks drafts.

Rules that hold whatever the scorer:
- Only documents from ``visible_documents(principal)`` are ever read.
- Unregistered documents are never used for answers.
- Outdated documents are never used for answers (they're reported, not cited).
- Lines aimed at an AI assistant are never used as excerpts.
- Semantic hits are only accepted for documents in that same visible, usable set.
"""

import math
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import Principal
from app.models import Document, DocumentStatus
from app.services.documents.access import visible_documents
from app.services.documents.checks import ai_instruction_lines
from app.services.knowledge.service import SemanticHit

TRUST_WEIGHT = {
    DocumentStatus.APPROVED.value: 1.0,
    DocumentStatus.REFERENCE.value: 0.85,
    DocumentStatus.UNKNOWN.value: 0.7,
    DocumentStatus.DRAFT.value: 0.5,
}
MIN_COVERAGE = 0.34  # share of the question's weighted terms a passage must contain
MAX_SOURCES = 3
EXCERPT_CHARS = 600
# Semantic hits: cosine distance from Cognee's vector search (lower is closer).
SEMANTIC_MAX_DISTANCE = 0.5
SEMANTIC_WEIGHT = 0.5

STOPWORDS = frozenset(
    [
        "a",
        "about",
        "after",
        "again",
        "all",
        "also",
        "am",
        "an",
        "and",
        "any",
        "are",
        "as",
        "at",
        "be",
        "been",
        "before",
        "being",
        "but",
        "by",
        "can",
        "could",
        "did",
        "do",
        "does",
        "doing",
        "for",
        "from",
        "had",
        "has",
        "have",
        "having",
        "he",
        "her",
        "here",
        "hers",
        "him",
        "his",
        "how",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "me",
        "my",
        "no",
        "nor",
        "not",
        "of",
        "off",
        "on",
        "once",
        "only",
        "or",
        "our",
        "ours",
        "out",
        "over",
        "own",
        "same",
        "she",
        "should",
        "so",
        "some",
        "such",
        "than",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "these",
        "they",
        "this",
        "those",
        "through",
        "to",
        "too",
        "under",
        "until",
        "up",
        "very",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "while",
        "who",
        "whom",
        "why",
        "will",
        "with",
        "would",
        "you",
        "your",
        "yours",
        "s",
        "t",
        "tell",
        "show",
        "give",
        "know",
        "want",
        "need",
        "please",
        "current",
        "latest",
        "now",
    ]
)


def tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    out = []
    for w in words:
        if w in STOPWORDS:
            continue
        if len(w) > 4 and w.endswith("ies"):
            w = w[:-3] + "y"
        elif len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return out


def blocks(content: str) -> list[str]:
    """Split a document into readable blocks: paragraphs, whole lists, whole tables."""
    parts = [b.strip() for b in re.split(r"\n\s*\n", content) if b.strip()]
    return [b for b in parts if not b.startswith("# ") or "\n" in b] or parts


@dataclass
class Passage:
    document: Document
    excerpt: str
    relevance: float
    score: float


@dataclass
class RetrievalResult:
    passages: list[Passage]
    searched: int
    outdated_matches: list[Document] = field(default_factory=list)
    # Drafts that matched but ranked below the cited sources: worth a warning.
    draft_matches: list[Document] = field(default_factory=list)
    candidates: list[dict[str, object]] = field(default_factory=list)


def _clip(text: str) -> str:
    return text if len(text) <= EXCERPT_CHARS else text[:EXCERPT_CHARS].rsplit(" ", 1)[0] + "…"


def _semantic_excerpt(chunk: str, injected: set[str]) -> str:
    """A chunk as an excerpt: blocks aimed at an AI and a bare title heading are dropped."""
    parts = [
        b
        for b in blocks(chunk)
        if not any(line in b for line in injected) and not (b.startswith("# ") and "\n" not in b)
    ]
    return "\n\n".join(parts).strip()


def _semantic_relevance(hits: Sequence[SemanticHit]) -> dict[uuid.UUID, tuple[float, str]]:
    """Best semantic match per document: (relevance 0..1, chunk text)."""
    best: dict[uuid.UUID, tuple[float, str]] = {}
    for hit in hits:
        if hit.distance > SEMANTIC_MAX_DISTANCE:
            continue
        relevance = 1 - hit.distance / SEMANTIC_MAX_DISTANCE * 0.5  # 1.0 .. 0.5
        if hit.document_id not in best or relevance > best[hit.document_id][0]:
            best[hit.document_id] = (relevance, hit.text)
    return best


async def retrieve(
    db: AsyncSession,
    principal: Principal,
    question: str,
    semantic: Sequence[SemanticHit] = (),
) -> RetrievalResult:
    docs = list(
        (
            await db.scalars(
                visible_documents(principal).options(selectinload(Document.access_group))
            )
        ).all()
    )
    usable = [d for d in docs if d.is_registered]
    query = set(tokens(question))
    sem = _semantic_relevance(semantic)
    if (not query and not sem) or not usable:
        return RetrievalResult(passages=[], searched=len(usable))

    doc_tokens = {d.id: set(tokens(d.title + "\n" + d.content)) for d in usable}
    n = len(usable)
    idf = {t: math.log(1 + n / (1 + sum(t in toks for toks in doc_tokens.values()))) for t in query}
    total = sum(idf.values()) or 1.0

    scored: list[Passage] = []
    outdated: list[Document] = []
    candidates: list[dict[str, object]] = []
    for doc in usable:
        title_terms = set(tokens(doc.title))
        injected = set(ai_instruction_lines(doc.content))
        best: tuple[tuple[float, float, int], str] | None = None
        doc_blocks = blocks(doc.content)
        body = [b for b in doc_blocks if not b.startswith("# ")] or doc_blocks
        for block in body:
            if any(line in block for line in injected):
                continue  # never quote text aimed at an AI
            own = sum(idf[t] for t in query if t in set(tokens(block)))
            covered = sum(idf[t] for t in query if t in set(tokens(block)) | title_terms)
            # Rank by coverage (title counts), then by the block's own matches, then by substance.
            key = (covered, own, len(block))
            if best is None or key > best[0]:
                best = (key, block)
        lexical = best[0][0] / total if best else 0.0
        semantic_match = sem.get(doc.id)
        if best is None and semantic_match is None:
            continue
        relevance = lexical
        excerpt_text = best[1] if best else ""
        if semantic_match is not None:
            fused = (1 - SEMANTIC_WEIGHT) * lexical + SEMANTIC_WEIGHT * semantic_match[0]
            if fused > relevance:
                relevance = fused
            chunk = _semantic_excerpt(semantic_match[1], injected)
            if chunk and (lexical < MIN_COVERAGE or not excerpt_text):
                excerpt_text = chunk  # the passage the semantic search actually matched
        candidate: dict[str, object] = {
            "title": doc.title,
            "status": doc.status,
            "relevance": round(relevance, 3),
        }
        if semantic:
            candidate["lexical"] = round(lexical, 3)
            candidate["semantic"] = round(semantic_match[0], 3) if semantic_match else None
        candidates.append(candidate)
        if relevance < MIN_COVERAGE or not excerpt_text:
            continue
        if doc.status == DocumentStatus.OUTDATED.value:
            outdated.append(doc)
            continue
        weight = TRUST_WEIGHT.get(doc.status, 0.5)
        excerpt = _clip(excerpt_text)
        scored.append(
            Passage(document=doc, excerpt=excerpt, relevance=relevance, score=relevance * weight)
        )

    scored.sort(key=lambda p: (-p.score, p.document.title.lower()))
    candidates.sort(key=lambda c: -float(str(c["relevance"])))
    drafts = [
        p.document for p in scored[MAX_SOURCES:] if p.document.status == DocumentStatus.DRAFT.value
    ]
    return RetrievalResult(
        passages=scored[:MAX_SOURCES],
        searched=len(usable),
        outdated_matches=outdated,
        draft_matches=drafts,
        candidates=candidates[:10],
    )
