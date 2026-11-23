# Thinq

**An organizational knowledge assistant whose answers are current, approved, and safe for the person asking.**

Most "company brains" fail the same way: they search everything and confidently repeat whatever they find, whether that's an unapproved draft, a retired form, or a document the person was never allowed to see. Thinq starts from the opposite end. It knows who owns each document, whether it is approved, and who may see it, and it checks access on every request before anything reaches the AI.

> **Status:** early development. User management, access groups, and the document library with access control and data-quality checks are in place. Trust ranking and the assistant itself are next.

## What works today

- **Sign-in:** email and password (Argon2), server-side sessions in HttpOnly cookies, failed-login throttling. An optional demo mode adds one-click sign-in as any user.
- **Access groups:** people get access through groups, never individually. A built-in **Everyone** group covers every active user.
- **Instant access changes:** a user's groups and role are re-read from the database on every request. When an Admin removes someone from a group, it applies to that person's very next request, with no sign-out and no waiting for a sync.
- **Safeguards:** Admins can't demote or deactivate themselves, and the last Admin can't be removed. Deactivating a user ends their sessions immediately.
- **Audit log:** every sign-in and every change to people, roles and groups is recorded with who did it and when.
- **Document library:** documents and a manifest are imported from a folder, re-scanned on every start, and versioned when they change. A person only sees documents shared with one of their groups; everything else returns "not found", including search and version history.
- **Data-quality checks:** unregistered files, near-duplicate copies, missing owners or statuses, owners that are teams, confidential files shared too widely, text aimed at AI assistants, and manifest drift are flagged in an Admin "Needs attention" queue with one-click fixes.
- **System status:** a public page with live web, API and database health, plus a streaming check.

## Quick start

You need Docker with Compose v2.22 or later.

```sh
git clone <this repository> thinq && cd thinq
cp .env.example .env
docker compose up -d --build --wait
```

Open <http://localhost:3000>. The sample organization in `seed/sample` is loaded on first start:

| Person      | Role   | Groups              | Password          |
|-------------|--------|---------------------|-------------------|
| Alex Morgan | Admin  | Operations, Finance | `thinq-demo-2026` |
| Dana Lee    | Member | Operations          | `thinq-demo-2026` |
| Sam Patel   | Member | Finance             | `thinq-demo-2026` |

Demo mode is on in `.env.example`, so you can also sign in with one click. **Turn it off (`THINQ_DEMO_MODE=false`) and change the seed password for any real deployment.**

To load your own people and documents, point `THINQ_SEED_PATH` at a folder containing `users.csv`, `manifest.csv` and a `documents/` folder ([format](seed/README.md)).

## Architecture

```
Browser ──► Next.js (web, :3000) ──/api/*──► FastAPI (internal) ──► PostgreSQL 18 + pgvector
```

- **One origin.** The browser only talks to the Next.js server, which forwards `/api/*` to the API over the internal Docker network and streams responses through. There's no CORS, and the session cookie never leaves the site.
- **The backend owns every rule.** Authentication, authorization and auditing live in FastAPI. The web app never decides who can see what.
- **Sessions, not self-contained tokens.** The cookie holds an opaque random token, and only its SHA-256 is stored. A token that carried a user's groups would stay valid after an Admin removed them.

| Layer     | Technology |
|-----------|------------|
| Web       | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6, Tailwind CSS 4, shadcn/ui on Base UI, TanStack Query |
| API       | Python 3.14, FastAPI, SQLAlchemy 2.1 (async), Alembic, psycopg 3, pwdlib (Argon2), structlog |
| Database  | PostgreSQL 18 with pgvector |
| Tooling   | uv, pnpm, Ruff, mypy (strict), Biome, pytest, Vitest, Playwright |

## Development

```sh
make dev      # hot reload; API on 127.0.0.1:8000, database on 127.0.0.1:55432
make test     # backend tests against real PostgreSQL + frontend unit tests
make test-e2e # browser tests against the full stack
make lint     # Ruff, mypy, Biome, TypeScript
make help     # everything else
```

Running the backend or frontend outside Docker needs [uv](https://docs.astral.sh/uv/) and Node.js 24+ with pnpm 12.

Database changes go through Alembic migrations in `backend/migrations`. They run automatically on start, under a lock, so concurrent starts are safe. After changing the API, run `make api-types` to regenerate the frontend's typed client. CI fails if it is out of date.

API documentation is served at `/api/docs` when the stack is running.

## Configuration

All settings are environment variables. See [`.env.example`](.env.example) for the common ones and `backend/app/core/config.py` for the full list.

| Variable              | Default          | Purpose |
|-----------------------|------------------|---------|
| `THINQ_PORT`          | `3000`           | Port the web app is published on |
| `THINQ_DEMO_MODE`     | `false`          | One-click sign-in as any user. Never enable in production |
| `THINQ_SEED_PATH`     | `./seed/sample`  | Folder with `users.csv`, loaded once into an empty database |
| `THINQ_SEED_PASSWORD` | *(empty)*        | Initial password for seeded users |
| `THINQ_COOKIE_SECURE` | `false`          | Set to `true` behind HTTPS |
| `POSTGRES_PASSWORD`   | `thinq`          | Database password. Change it for any shared deployment |

## License

[Apache License 2.0](LICENSE). Illustrations on the public pages are [Open Doodles](https://www.opendoodles.com) by Pablo Stanley, CC0.
