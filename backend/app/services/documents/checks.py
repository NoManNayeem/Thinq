"""Data-quality checks. Pure functions over plain data, so they're easy to test."""

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.models import DocumentStatus, FlagSeverity

DUPLICATE_THRESHOLD = 0.8
TEAM_WORDS = {
    "team",
    "department",
    "dept",
    "operations",
    "ops",
    "finance",
    "hr",
    "it",
    "legal",
    "support",
}

_STATUS_WORDS = {
    "approved": DocumentStatus.APPROVED,
    "draft": DocumentStatus.DRAFT,
    "outdated": DocumentStatus.OUTDATED,
    "retired": DocumentStatus.OUTDATED,
    "superseded": DocumentStatus.OUTDATED,
    "reference": DocumentStatus.REFERENCE,
}
_STATUS_LINE = re.compile(r"^\W*status\W*:\s*\**\s*([a-z]+)", re.IGNORECASE | re.MULTILINE)
_CONFIDENTIAL = re.compile(
    r"confidential\W*(?:[:\-\u2013\u2014]\s*)?(?:(\w[\w ]{0,30}?)\s+only)?", re.IGNORECASE
)
_AI_INSTRUCTION = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(?:ai|llm|gpt|chatbot|assistant)s?\b[^\n]{0,40}\b(?:instruction|instructions|ignore|disregard|always|must|should)\b",
        r"\b(?:ignore|disregard|bypass|override)\b[^\n]{0,30}\b(?:instructions|rules|access|restrictions|guardrails)\b",
        r"\bsystem prompt\b",
    )
]


@dataclass(frozen=True)
class Finding:
    kind: str
    severity: FlagSeverity
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def fingerprint(self) -> str:
        payload = json.dumps(
            {"kind": self.kind, "details": self.details}, sort_keys=True, default=str
        )
        return hashlib.sha256(payload.encode()).hexdigest()


@dataclass(frozen=True)
class DocFacts:
    """What the checks need to know about one document."""

    id: str
    title: str
    source_path: str
    content: str
    status: str
    owner_name: str | None
    access_group_slug: str | None
    access_group_name: str | None
    is_registered: bool
    source_present: bool
    manifest_group_name: str | None = None
    manifest_drift: dict[str, Any] = field(default_factory=dict)
    # Set when an Approved document's review is overdue (see services.documents.trust).
    review_overdue_since: str | None = None
    last_reviewed: str | None = None


def _words(text: str) -> list[str]:
    return re.findall(r"\w+", re.sub(r"[#*_`>|\[\]()]", " ", text.lower()))


def shingles(text: str, k: int = 3) -> set[tuple[str, ...]]:
    words = _words(text)
    return {tuple(words[i : i + k]) for i in range(max(1, len(words) - k + 1))}


def similarity(a: set[tuple[str, ...]], b: set[tuple[str, ...]]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def stated_status(content: str) -> DocumentStatus | None:
    """The status a document declares about itself in its first lines, if any."""
    head = "\n".join(content.splitlines()[:15])
    match = _STATUS_LINE.search(head)
    return _STATUS_WORDS.get(match.group(1).lower()) if match else None


def confidentiality(content: str) -> tuple[bool, str | None]:
    """Whether the text marks itself confidential, and for which group if it says."""
    match = _CONFIDENTIAL.search(content)
    if not match:
        return False, None
    return True, (match.group(1) or "").strip() or None


def ai_instruction_lines(content: str) -> list[str]:
    return [
        line.strip()[:240]
        for line in content.splitlines()
        if line.strip() and any(p.search(line) for p in _AI_INSTRUCTION)
    ]


def owner_looks_like_team(owner: str, group_names: set[str]) -> bool:
    name = owner.strip().lower()
    if not name:
        return False
    if name in group_names:
        return True
    words = set(re.findall(r"[a-z]+", name))
    return len(name.split()) == 1 or bool(words & TEAM_WORDS)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def check_document(doc: DocFacts, group_names: set[str]) -> list[Finding]:
    found: list[Finding] = []
    if not doc.is_registered:
        found.append(
            Finding(
                "unregistered",
                FlagSeverity.CRITICAL,
                "This file isn't in the manifest, so nobody has recorded its owner, status "
                "or who may "
                "see it. Only Admins can see it until it's registered.",
            )
        )
    elif doc.access_group_slug is None:
        found.append(
            Finding(
                "unknown_access_group",
                FlagSeverity.CRITICAL,
                "The manifest gives access group "
                f'"{doc.manifest_group_name or "(blank)"}", which doesn\'t '
                "exist. Only Admins can see this document until a group is assigned.",
                {"manifest_group": doc.manifest_group_name},
            )
        )
    if not doc.source_present:
        found.append(
            Finding(
                "source_missing",
                FlagSeverity.WARNING,
                "The source file is missing. The last imported copy is shown.",
                {"source_path": doc.source_path},
            )
        )
    if doc.is_registered and doc.review_overdue_since:
        found.append(
            Finding(
                "review_overdue",
                FlagSeverity.WARNING,
                "This approved document is overdue for review "
                f"(due {doc.review_overdue_since}). Ask the owner to confirm it's still correct.",
                {"last_reviewed": doc.last_reviewed, "due": doc.review_overdue_since},
            )
        )
    if doc.is_registered and doc.status == DocumentStatus.UNKNOWN:
        found.append(
            Finding(
                "missing_status",
                FlagSeverity.WARNING,
                "No status is recorded, so nobody knows if this is approved.",
            )
        )
    if doc.is_registered and not (doc.owner_name or "").strip():
        found.append(
            Finding(
                "missing_owner", FlagSeverity.WARNING, "No owner is recorded for this document."
            )
        )
    if doc.owner_name and owner_looks_like_team(doc.owner_name, group_names):
        found.append(
            Finding(
                "owner_is_team",
                FlagSeverity.INFO,
                f'The owner is "{doc.owner_name}", which looks like a team rather than a person. '
                "Questions and corrections need a named person.",
                {"owner": doc.owner_name},
            )
        )

    stated = stated_status(doc.content)
    if stated is not None and doc.is_registered and stated != doc.status:
        found.append(
            Finding(
                "status_mismatch",
                FlagSeverity.WARNING,
                f'The document says it is "{stated.value}", '
                f'but its recorded status is "{doc.status}".',
                {"stated": stated.value, "recorded": doc.status},
            )
        )

    confidential, for_group = confidentiality(doc.content)
    if confidential and doc.access_group_slug is not None:
        too_broad = doc.access_group_slug == "everyone" or (
            for_group is not None and _slug(for_group) != doc.access_group_slug
        )
        if too_broad:
            found.append(
                Finding(
                    "sensitivity_mismatch",
                    FlagSeverity.CRITICAL,
                    "The document is marked confidential"
                    f"{f' ({for_group} only)' if for_group else ''}, "
                    f'but it is shared with "{doc.access_group_name}".',
                    {"marked_for": for_group, "shared_with": doc.access_group_name},
                )
            )

    lines = ai_instruction_lines(doc.content)
    if lines:
        found.append(
            Finding(
                "ai_instruction",
                FlagSeverity.WARNING,
                "The text contains instructions aimed at an AI assistant. "
                "Thinq treats document text as "
                "information, never as instructions, but the owner should review it.",
                {"lines": lines},
            )
        )

    if doc.manifest_drift:
        found.append(
            Finding(
                "manifest_drift",
                FlagSeverity.INFO,
                "The manifest now says something different from Thinq. Thinq's values were kept.",
                {"fields": doc.manifest_drift},
            )
        )
    return found


def _trust_rank(doc: DocFacts) -> tuple[int, int]:
    order = ["approved", "reference", "draft", "unknown", "outdated"]
    return (1 if doc.is_registered else 0, -order.index(doc.status) if doc.status in order else -9)


def duplicate_findings(docs: list[DocFacts]) -> dict[str, list[Finding]]:
    """Flag near-identical documents on the less trustworthy copy."""
    result: dict[str, list[Finding]] = {}
    prints = {d.id: shingles(d.content) for d in docs}
    for i, a in enumerate(docs):
        for b in docs[i + 1 :]:
            score = similarity(prints[a.id], prints[b.id])
            if score < DUPLICATE_THRESHOLD:
                continue
            copy, original = (a, b) if _trust_rank(a) <= _trust_rank(b) else (b, a)
            result.setdefault(copy.id, []).append(
                Finding(
                    "likely_duplicate",
                    FlagSeverity.WARNING,
                    f'This looks like a copy of "{original.title}" '
                    f"({round(score * 100)}% the same text).",
                    {
                        "of_document_id": original.id,
                        "of_title": original.title,
                        "similarity": round(score, 2),
                    },
                )
            )
    return result
