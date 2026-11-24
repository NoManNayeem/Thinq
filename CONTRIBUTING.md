# Contributing

Thanks for helping. A few things keep Thinq trustworthy; please keep them true in every change.

## Ground rules

1. **Access is decided in one place.** Any code that reads documents goes through
   `visible_documents` / `visibility_clause` in `backend/app/services/documents/access.py`.
   A document someone can't see is "not found" (404), never "forbidden".
2. **Nothing reaches a model that the asker couldn't read.** Retrieval filters first; the model
   only ever gets what retrieval returned for that person.
3. **Newer isn't approved.** Ranking and answers follow status, not dates.
4. **Every rule has a test.** Access and leak cases belong in `seed/sample/eval.json` (tag them
   `access`) as well as in unit tests.

## Setup

You need Docker, [uv](https://docs.astral.sh/uv/) and Node.js 24+ with pnpm 12.

```sh
make env      # creates .env from .env.example
make dev      # hot reload; API on :8000, database on :55432
make test     # backend (real PostgreSQL) + frontend unit tests
make test-e2e # browser tests against the full stack
make eval     # the golden question set against the running stack
make lint
```

After changing the API, run `make api-types` so the frontend's typed client matches. CI checks it.

## Style

- Backend: Ruff and mypy (strict). Frontend: Biome and TypeScript.
- UI: the design rules are enforced by `frontend/lib/design-system.test.ts` (4-point spacing,
  three font weights, the type scale, two font families). One primary action per screen; touch
  targets of at least 48 px on phones; every screen passes axe.
- Write UI text in plain language, in the second person, without jargon.

## Pull requests

Keep them focused, describe the behaviour change, and include tests. Don't include real company
data: use `seed/sample` or invent your own.
