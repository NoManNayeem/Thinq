"""Answer-quality evaluation: run a golden question set as real users, through the real API.

    uv run python -m app.eval --cases ../seed/sample/eval.json --base-url http://localhost:3000

Each case signs in as a user, asks a question in a new chat and checks what came back:
which documents were cited (and with what status), facts that must or must not appear,
whether the answer is a refusal, and which notices were shown. A case may first change access
(remove someone from a group) and always puts it back afterwards.

Cases tagged ``access`` (leaks, restricted content, removed access) are the ones CI must never
let fail. Exit code: 0 if every case passed, 1 otherwise (``--access-only`` runs just those).

Case format (JSON list):
    {"id": "q4", "tags": ["access"], "as": "dana@example.com", "question": "...",
     "setup": {"remove_from_group": {"user": "sam@example.com", "group": "Finance"}},
     "expect": {"top_source": "Payroll Calendar 2027", "top_status": "approved",
                "sources_include": [...], "sources_exclude": [...],
                "facts_any": [...], "facts_all": [...], "facts_none": [...],
                "refusal": true, "notices_include": ["draft_also"]}}

Facts are matched case-insensitively against the answer text. In preview mode (no AI model) the
answer is a list of excerpts, so facts are matched against the cited excerpts as well.
"""

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

REFUSAL_MARKERS = ("couldn't find", "could not find", "can't find", "don't have", "no information")


@dataclass
class CaseResult:
    id: str
    tags: list[str]
    passed: bool
    failures: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    engine: str | None = None


async def _login(base: str, email: str, password: str, transport: Any) -> httpx.AsyncClient:
    client = httpx.AsyncClient(base_url=base, timeout=180, transport=transport)
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        await client.aclose()
        raise RuntimeError(f"Sign-in failed for {email}: {r.status_code}")
    return client


async def ask(client: httpx.AsyncClient, question: str) -> dict[str, Any]:
    chat = (await client.post("/api/chat/conversations", json={})).json()["id"]
    text, parts = "", {}
    async with client.stream(
        "POST",
        f"/api/chat/conversations/{chat}/messages",
        json={"text": question, "trigger": "submit-message"},
    ) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            event = json.loads(line[6:])
            if event["type"] == "text-delta":
                text += event["delta"]
            else:
                parts[event["type"]] = event
    await client.delete(f"/api/chat/conversations/{chat}")  # leave no trace in history
    return {
        "text": text,
        "sources": parts.get("data-sources", {}).get("data", {}).get("items", []),
        "notices": parts.get("data-notices", {}).get("data", {}).get("items", []),
        "retrieval": parts.get("data-retrieval", {}).get("data", {}),
        "error": parts.get("error", {}).get("errorText"),
    }


def check(case: dict[str, Any], out: dict[str, Any]) -> list[str]:
    expect: dict[str, Any] = case.get("expect", {})
    failures: list[str] = []
    titles = [s["title"] for s in out["sources"]]
    engine = out["retrieval"].get("engine")
    haystack = out["text"]
    if engine == "preview":
        haystack += "\n" + "\n".join(s.get("excerpt", "") for s in out["sources"])
    low = haystack.lower()
    if out["error"]:
        failures.append(f"answer failed: {out['error']}")
    if "top_source" in expect and (not titles or titles[0] != expect["top_source"]):
        failures.append(f"top source {titles[:1]} != {expect['top_source']!r}")
    if "top_status" in expect and (
        not out["sources"] or out["sources"][0]["status"] != expect["top_status"]
    ):
        got = out["sources"][0]["status"] if out["sources"] else None
        failures.append(f"top status {got!r} != {expect['top_status']!r}")
    for t in expect.get("sources_include", []):
        if t not in titles:
            failures.append(f"missing source {t!r}")
    for t in expect.get("sources_exclude", []):
        if t in titles:
            failures.append(f"must not cite {t!r}")
    facts_any = expect.get("facts_any", [])
    if facts_any and not any(f.lower() in low for f in facts_any):
        failures.append(f"none of {facts_any} in the answer")
    for f in expect.get("facts_all", []):
        if f.lower() not in low:
            failures.append(f"missing fact {f!r}")
    # Forbidden facts are checked everywhere the person could read them.
    everything = (out["text"] + json.dumps(out["sources"]) + json.dumps(out["notices"])).lower()
    for f in expect.get("facts_none", []):
        if f.lower() in everything:
            failures.append(f"leaked {f!r}")
    if "refusal" in expect:
        refused = any(m in out["text"].lower() for m in REFUSAL_MARKERS)
        if refused != bool(expect["refusal"]):
            failures.append("expected a refusal" if expect["refusal"] else "unexpected refusal")
    kinds = {n["kind"] for n in out["notices"]}
    for k in expect.get("notices_include", []):
        if k not in kinds:
            failures.append(f"missing notice {k!r}")
    return failures


async def _membership(
    admin: httpx.AsyncClient, user_email: str, group_name: str, *, present: bool
) -> None:
    users = (await admin.get("/api/admin/users", params={"limit": 200})).json()["items"]
    user = next(u for u in users if u["email"].lower() == user_email.lower())
    group = next(
        g for g in (await admin.get("/api/admin/groups")).json() if g["name"] == group_name
    )
    path = f"/api/admin/users/{user['id']}/groups/{group['id']}"
    r = await (admin.put(path) if present else admin.delete(path))
    if r.status_code >= 400 and not (r.status_code == 409 and present):
        raise RuntimeError(f"Couldn't change {user_email} in {group_name}: {r.status_code}")


async def run(
    cases: list[dict[str, Any]],
    *,
    base_url: str,
    password: str,
    admin_email: str | None,
    transport: Any = None,
    access_only: bool = False,
) -> list[CaseResult]:
    clients: dict[str, httpx.AsyncClient] = {}

    async def client_for(email: str) -> httpx.AsyncClient:
        if email not in clients:
            clients[email] = await _login(base_url, email, password, transport)
        return clients[email]

    results: list[CaseResult] = []
    try:
        for case in cases:
            tags = list(case.get("tags", []))
            if access_only and "access" not in tags:
                continue
            setup = (case.get("setup") or {}).get("remove_from_group")
            admin = await client_for(admin_email) if setup and admin_email else None
            try:
                if setup and admin:
                    await _membership(admin, setup["user"], setup["group"], present=False)
                out = await ask(await client_for(case["as"]), case["question"])
                failures = check(case, out)
            except Exception as exc:
                out, failures = {"sources": [], "retrieval": {}}, [f"error: {exc}"]
            finally:
                if setup and admin:
                    await _membership(admin, setup["user"], setup["group"], present=True)
            results.append(
                CaseResult(
                    id=case["id"],
                    tags=tags,
                    passed=not failures,
                    failures=failures,
                    sources=[f"{s['title']} ({s['status']})" for s in out["sources"]],
                    engine=out["retrieval"].get("engine"),
                )
            )
    finally:
        for c in clients.values():
            await c.aclose()
    return results


def report(results: list[CaseResult]) -> str:
    lines = []
    for r in results:
        mark = "PASS" if r.passed else "FAIL"
        tag = f" [{', '.join(r.tags)}]" if r.tags else ""
        lines.append(f"{mark}  {r.id}{tag}  sources: {', '.join(r.sources) or 'none'}")
        lines.extend(f"      - {f}" for f in r.failures)
    passed = sum(r.passed for r in results)
    access = [r for r in results if "access" in r.tags]
    lines.append(
        f"\n{passed}/{len(results)} passed"
        + (f"; access cases {sum(r.passed for r in access)}/{len(access)}" if access else "")
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--password", default="thinq-demo-2026")
    parser.add_argument("--admin", default=None, help="Admin email, for cases that change access")
    parser.add_argument("--access-only", action="store_true")
    args = parser.parse_args()
    spec = json.loads(args.cases.read_text())
    cases = spec["cases"] if isinstance(spec, dict) else spec
    admin = args.admin or (spec.get("admin") if isinstance(spec, dict) else None)
    results = asyncio.run(
        run(
            cases,
            base_url=args.base_url,
            password=args.password,
            admin_email=admin,
            access_only=args.access_only,
        )
    )
    print(report(results))
    sys.exit(0 if all(r.passed for r in results) else 1)


if __name__ == "__main__":
    main()
