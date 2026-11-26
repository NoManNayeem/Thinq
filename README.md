# Thinq

**An organizational knowledge assistant whose answers are current, approved, and safe for the person asking.**

Most "company brains" fail the same way: they search everything and confidently repeat whatever they find, whether that's an unapproved draft, a retired form, or a document the person was never allowed to see. Thinq starts from the opposite end. It knows who owns each document, whether it's approved, and who may see it, and it checks access on every request before anything reaches the AI.

<p align="center">
  <img src="screenshots/04-chat-approved-answer.png" alt="Ask Thinq: the answer cites the approved Travel Policy v2, notes that a newer draft exists and that an outdated version was left out, and names its top source with its status." width="100%">
</p>

**Contents:** [Video walkthrough](#video-walkthrough) · [What it does](#what-it-does) · [Screenshots](#screenshots) · [How it works](#how-it-works) · [Quick start](#quick-start) · [Your own data](#use-your-own-data) · [No seed](#start-empty-no-seed) · [AI and Cognee](#turn-on-ai-answers-and-the-knowledge-layer) · [Develop locally](#develop-locally) · [Test](#test) · [Production](#go-to-production) · [Configuration](#configuration)

## Video walkthrough

A 12-minute tour: running it with Docker, the README, and the app in use, with every feature shown live.

<p align="center">
  <a href="https://youtu.be/gh0cZCoOrsc">
    <img src="https://img.youtube.com/vi/gh0cZCoOrsc/maxresdefault.jpg" alt="Watch the Thinq walkthrough on YouTube" width="100%">
  </a>
</p>

<p align="center"><a href="https://youtu.be/gh0cZCoOrsc"><b>▶ Watch on YouTube</b></a></p>

## What it does

| | |
|---|---|
| **Trusted answers** | Answers cite their sources with status, owner and review date. Approved documents outrank newer drafts; outdated versions are never used; "I couldn't find it" is a real answer. |
| **Access first** | People see documents through access groups. Every request re-reads their groups, retrieval is filtered before anything reaches a model, and removing access applies to the very next question. Hidden documents are "not found", everywhere. |
| **Any AI, or none** | Any [Pydantic AI](https://ai.pydantic.dev) model (OpenAI, Anthropic, Google, Groq, Ollama, any OpenAI-compatible endpoint), with fallbacks. With no model, a preview mode answers with the most trusted excerpts. |
| **Trust and approval** | Versions are grouped; owners or Admins approve, reject, retire and review, with full history. Approved memos can propose status changes for a person to confirm. Overdue reviews are flagged. |
| **Data quality** | Unregistered files, near-duplicates, missing owners or statuses, team owners, over-shared confidential files, text aimed at AI assistants and manifest drift are flagged with one-click fixes. |
| **Feedback loop** | "Not helpful" on an answer, or "Report a problem" on a document, reaches the document's owner (or Admins); the reporter sees the outcome. |
| **Sources and sync** | A folder of Markdown/text files plus a manifest, synced on start, on a schedule and on demand, with versions, renames and deletions handled. Admins can upload documents too. |
| **Knowledge graph** | How the documents a person can see connect: versions, owners, groups and (with Cognee) topics. |
| **Quality and operations** | A golden question set (`make eval`, in CI), a quality dashboard and retrieval inspector, audit log, metrics, backups. |

## Screenshots

Taken with the sample organization in [`seed/sample`](seed/sample) (Dana in Operations, Sam in Finance, Alex as Admin), a small local model through Ollama, and the optional Cognee layer on. Regenerate them with `make screenshots`.

### 1. Approved beats newer, and every answer shows its source and status

Dana asks for the current travel policy. Thinq answers from the **Approved** v2, says a newer draft isn’t approved yet, leaves out the outdated version, and names its top source with its status.

<img src="screenshots/04-chat-approved-answer.png" alt="Answer citing the approved Travel Policy v2 with draft and outdated notices" width="100%">

Sources open only when wanted: each shows its status, who can see it, the owner, the last review and the passage used.

<img src="screenshots/05-chat-sources.png" alt="Sources opened: status, access group, owner, review date and the excerpt used" width="100%">

### 2. Access is enforced before anything reaches the AI

Dana (Operations) asks when payroll runs. The Finance-only calendar is never retrieved, so the model never sees it: “I couldn’t find it”, with no source shown.

<img src="screenshots/06-chat-restricted-ops.png" alt="Operations user asks about payroll and gets no Finance content" width="100%">

Sam (Finance) asks the same question and gets the answer, cited to the Approved, Finance-only Payroll Calendar.

<img src="screenshots/07-chat-finance.png" alt="Finance user asks the same question and gets the Finance-only answer" width="100%">

### 3. Removing access applies on the very next question

Alex (Admin) removes Sam from Finance, with undo. It applies to Sam’s very next request: no sign-out, no sync.

<img src="screenshots/08-admin-remove-access.png" alt="Admin removes Sam from the Finance group, with undo" width="100%">

Sam’s earlier Finance answer is hidden, and asking again finds nothing he can access.

<img src="screenshots/09-chat-access-removed.png" alt="Sam’s earlier answer is hidden and the same question now finds nothing" width="100%">

<details>
<summary><strong>More screenshots</strong>: trust and approval, data quality, knowledge graph, feedback, operations, phone</summary>

### Ask, or browse what you can access

Ask Thinq says which groups answers come from, and suggests questions only from documents the person can see.

<img src="screenshots/03-chat-welcome.png" alt="Ask Thinq welcome screen with suggestions from documents Dana can see" width="100%">

The library lists every document the person may see, with its status, owner, last review and access group.

<img src="screenshots/10-library.png" alt="Library listing every document Dana can see with status, owner and access group" width="100%">

### Trust and approval

Every document shows its status, owner, review dates and audience, and the versions of the same document: the approved one is current even when a draft is newer. Only the owner or an Admin can change status, and every change is recorded.

<img src="screenshots/11-document-trust.png" alt="Document page with status actions, versions of the document and approval history" width="100%">

When an approved document (here, a memo) names another as the one to use, Thinq proposes the change and a person confirms. Drafts and documents nobody has given a status wait here too.

<img src="screenshots/12-approvals.png" alt="Approvals: a proposal from an approved memo, a draft awaiting approval, a document with no status" width="100%">

### Messy data is flagged, not trusted

A file missing from the manifest, a near-duplicate copy, missing owners and statuses, a team listed as owner, and a planted instruction aimed at AI assistants, each flagged with a fix. Unregistered files are visible to Admins only and never used for answers.

<img src="screenshots/13-needs-attention.png" alt="Needs attention: unregistered copy, missing owner and status, owner is a team, instructions aimed at AI" width="100%">

### Knowledge graph

How the documents a person can access connect: versions (oldest to newest), owners, groups and, with Cognee, the topics they mention. Finance documents never appear for Dana.

<img src="screenshots/14-knowledge-graph.png" alt="Knowledge graph of the documents Dana can see, with Travel Policy v2 selected" width="100%">

### Feedback reaches the person who can fix it

“Not helpful” on an answer goes to the owner of the document it cited (or to Admins), with the question, the note and the answer.

<img src="screenshots/15-feedback-inbox.png" alt="Owner’s inbox with a report from Dana: the question, her note and the answer she got" width="100%">

The person who flagged it sees what was done about it.

<img src="screenshots/16-feedback-outcome.png" alt="Dana sees that her report was fixed, with the owner’s note" width="100%">

### Operations and quality

A folder plus a manifest, synced on start, on a schedule and on demand. Renames keep history, deleted files leave answers at once, a failed sync changes nothing. Admins can also upload documents.

<img src="screenshots/17-sources-and-sync.png" alt="Sources and sync: shared folder, schedule, sync history" width="100%">

Live figures from answers and feedback, and a retrieval inspector that shows what any person’s question would use, and why.

<img src="screenshots/18-answer-quality.png" alt="Answer quality dashboard and retrieval inspector" width="100%">

The Admin overview lists settings that are fine for a demo but unsafe for real use.

<img src="screenshots/20-admin-overview.png" alt="Admin overview with settings to change before real use" width="100%">

Sign-ins, access changes, status changes and questions (never their text) are in the audit log.

<img src="screenshots/19-audit-log.png" alt="Audit log" width="100%">

### On a phone

<img src="screenshots/21-mobile-chat.png" alt="Chat on a phone" width="49%"> <img src="screenshots/22-mobile-graph.png" alt="Knowledge graph details on a phone" width="49%">

### Before signing in

<img src="screenshots/01-landing.png" alt="Public landing page" width="100%">

<img src="screenshots/02-sign-in.png" alt="Sign-in with demo accounts" width="100%">

</details>

## How it works

### Services

```mermaid
flowchart LR
  B[Browser] -->|pages and /api/*| W[web<br/>Next.js :3000]
  W -->|/api/* over the internal network| A[api<br/>FastAPI]
  A --> P[(PostgreSQL 18<br/>+ pgvector)]
  A -. optional .-> L[AI provider<br/>via Pydantic AI]
  A -. optional .-> C[cognee<br/>knowledge layer]
  C -. own database .-> P
  F[(Shared folder<br/>documents + manifest)] -->|sync| A
```

The browser only ever talks to the web app, which forwards `/api/*` to the API and streams responses through: one origin, no CORS, and the session cookie stays first-party. The API owns every rule; the web app never decides who can see what.

### Answering a question

```mermaid
sequenceDiagram
  actor U as Person
  participant API as Thinq API
  participant DB as PostgreSQL
  participant K as Cognee (optional)
  participant M as AI model (optional)
  U->>API: question
  API->>DB: who is this, and which groups are they in right now?
  API->>K: semantic search in this person's group datasets
  K-->>API: candidate passages
  API->>DB: keep only documents this person can see now (current version)
  Note over API: rank by relevance and trust:<br/>Approved > Reference > Unknown > Draft, Outdated never used
  alt nothing they can see answers it
    API-->>U: "I couldn't find it", and who owns the process
  else sources found
    API->>M: only those sources, framed as data, AI-instruction lines removed
    M-->>API: answer with [n] citations
    API-->>U: streamed answer, invalid citations dropped, sources with status
  end
```

The model has no tools, so a document can't talk it into fetching more, and it can never see more than the person asking.

### Who can see a document

```mermaid
flowchart TD
  D{Document has an<br/>access group?} -- no --> AD{Person is an Admin?}
  AD -- yes --> V[Visible]
  AD -- no --> H[Not found]
  D -- yes --> G{Person is in that<br/>group right now?}
  G -- yes --> V
  G -- no --> H
```

The Admin role never grants access to a group's documents; Admins see only unshared files (to triage them) and the groups they belong to. The same rule decides the library, search, versions, answers, sources, the knowledge graph, approvals and feedback.

### A document's life

```mermaid
stateDiagram-v2
  [*] --> Unregistered: file not in manifest
  [*] --> Draft
  [*] --> Unknown: no status recorded
  Unregistered --> Draft: Admin registers it
  Draft --> Approved: owner or Admin approves
  Unknown --> Approved: confirmed, e.g. from an approved memo
  Approved --> Outdated: a newer version is approved, or retired
  Approved --> Approved: review confirmed
  Outdated --> [*]
```

A rejected draft stays a draft, with the reason recorded. Approving a new version retires the previous approved one in the same step. Every change is recorded with who made it and why.

### Feedback loop

```mermaid
flowchart LR
  R[Person flags an answer<br/>or a document] --> O{Cited document has an owner<br/>with an account who can see it?}
  O -- yes --> I1[Owner's inbox]
  O -- no --> I2[Admins' inbox]
  I1 --> X[Resolved: fixed, no change,<br/>or document marked outdated]
  I2 --> X
  X --> S[Reporter sees the outcome]
```

| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6, Tailwind CSS 4, shadcn/ui on Base UI, TanStack Query, AI SDK UI |
| API | Python 3.14, FastAPI, SQLAlchemy 2.1 (async), Alembic, psycopg 3, Pydantic AI, structlog |
| Knowledge (optional) | Cognee 1.6 in its own container: pgvector, Postgres graph store, local fastembed embeddings |
| Database | PostgreSQL 18 with pgvector |
| Tooling | uv, pnpm, Ruff, mypy (strict), Biome, pytest, Vitest, Playwright |

More detail in [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

You need Docker with Compose v2.22 or later. This starts Thinq with the sample organization in [`seed/sample`](seed/sample), in preview mode (no AI model needed).

```sh
git clone <this repository> thinq && cd thinq
cp .env.example .env
docker compose up -d --build --wait
```

Open <http://localhost:3000> and sign in. Demo mode is on in `.env.example`, so you can also pick a person with one click.

| Person | Role | Groups | Password |
|---|---|---|---|
| Alex Morgan | Admin | Operations, Finance | `thinq-demo-2026` |
| Dana Lee | Member | Operations | `thinq-demo-2026` |
| Sam Patel | Member | Finance | `thinq-demo-2026` |

Things to try:

1. As **Dana**, ask *"What's the current travel policy?"*: the Approved v2 wins over the newer v3 draft.
2. As **Dana**, ask *"When does payroll run each month?"*: the Finance-only calendar is never used.
3. As **Sam**, ask the same: he gets the answer, cited to the Finance document.
4. As **Alex**, open **Users → Sam Patel** and remove him from Finance; Sam's next question finds nothing, and his earlier answer is hidden.
5. As **Alex**, open **Needs attention** to see the sample's deliberate data problems.

Stop with `docker compose down` (data is kept) or `make reset-db` (deletes it).

## Use your own data

Make a folder like this and point `THINQ_SEED_PATH` at it in `.env`:

```text
my-org/
├── users.csv        # people and their groups (loaded once, into an empty database)
├── manifest.csv     # one row per document: owner, status, dates, access group
└── documents/       # Markdown or text files; sub-folders are fine
```

```sh
# .env
THINQ_SEED_PATH=./my-org
THINQ_SEED_PASSWORD=choose-a-first-password   # or leave empty and set passwords in the app
```

Then `docker compose up -d --build --wait`. The column formats are in [seed/README.md](seed/README.md).

- `users.csv` is read **only while the database has no users**, so later changes made in Thinq are never overwritten. To start over, run `make reset-db` first.
- The folder is **synced** on start, every 5 minutes (`THINQ_SYNC_INTERVAL_S`) and on **Sources and sync → Sync now**. Edits create versions, renames and moves keep history, deleted files leave answers at once.
- Files missing from the manifest are imported as **unregistered**: only Admins see them until someone assigns an access group.
- After the first import Thinq is the system of record: later manifest changes are shown to Admins as drift, not applied.

## Start empty (no seed)

To start with no people and no documents, point the seed at the empty folder:

```sh
# .env
THINQ_SEED_PATH=./seed/empty
THINQ_DEMO_MODE=false
```

```sh
docker compose up -d --build --wait
```

Open <http://localhost:3000/sign-in>. With no users, Thinq sends you to a **one-time setup** that creates the first Admin and signs you in. It closes for good once any user exists. Then:

1. **Groups:** create your access groups (Everyone exists already).
2. **Users:** add people and put them in groups.
3. **Sources and sync → Upload document:** add Markdown or text documents with an access group, owner and status. Or add a `documents/` folder (and optionally `manifest.csv`) to the seed folder and press **Sync now**.

## Turn on AI answers and the knowledge layer

Both are optional; Thinq works without either.

**AI answers.** Set a model in `.env`, plus the provider's key:

```sh
THINQ_LLM_MODEL=anthropic:claude-sonnet-5-5      # with ANTHROPIC_API_KEY=...
# THINQ_LLM_MODEL=openai:gpt-5.2                 # with OPENAI_API_KEY=...
# THINQ_LLM_MODEL=google-gla:gemini-3-flash      # with GOOGLE_API_KEY=...
# THINQ_LLM_MODEL=groq:llama-4-scout             # with GROQ_API_KEY=...
# THINQ_LLM_MODEL=ollama:qwen3:4b-instruct-2507-q4_K_M   # local Ollama, no key
THINQ_LLM_FALLBACK_MODELS=                       # optional, comma-separated, tried in order
```

For Ollama on the same machine, the default `OLLAMA_BASE_URL=http://host.docker.internal:11434/v1` already works.

**Cognee knowledge layer** (semantic search and topics in the knowledge graph):

```sh
COMPOSE_PROFILES=cognee
THINQ_RETRIEVER=cognee
COGNEE_LLM_PROVIDER=ollama          # the model Cognee uses to extract topics (see .env.example)
COGNEE_LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M
```

Run `docker compose up -d --build --wait` after any change. Cognee builds its graph in the background (a few minutes for the sample with a small local model); until then, and whenever Cognee is unavailable, Thinq uses its built-in search. Embeddings run locally, so document text isn't sent anywhere for indexing.

## Develop locally

```sh
make env      # create .env from .env.example
make dev      # hot reload: web on :3000, API on 127.0.0.1:8000, database on 127.0.0.1:55432
```

`make dev` bind-mounts the source, so backend and frontend changes reload on save. Interactive API docs are at <http://localhost:8000/api/docs>.

- **Database changes:** add an Alembic migration in `backend/migrations` (with the dev database running: `cd backend && THINQ_DATABASE_URL=postgresql+psycopg://thinq:thinq@127.0.0.1:55432/thinq uv run alembic revision --autogenerate -m "…"`). Migrations run automatically on start, under a lock.
- **API changes:** run `make api-types` to regenerate the frontend's typed client. CI fails if it's out of date.
- **Outside Docker:** you need [uv](https://docs.astral.sh/uv/) and Node.js 24+ with pnpm 12. Start only the database, then run each side yourself:

  ```sh
  make db                                   # PostgreSQL on 127.0.0.1:55432
  cd backend
  export THINQ_DATABASE_URL=postgresql+psycopg://thinq:thinq@127.0.0.1:55432/thinq THINQ_SEED_DIR=../seed/sample THINQ_SEED_PASSWORD=thinq-demo-2026
  uv run python -m app.prestart             # migrations, seed and first sync
  uv run uvicorn app.main:app --reload      # API on :8000
  cd ../frontend && pnpm install && pnpm dev   # web on :3000, forwards /api to :8000
  ```

## Test

| Command | What it runs |
|---|---|
| `make test` | Backend tests against a real PostgreSQL (started with `make db`), plus frontend unit tests |
| `make test-e2e` | Browser tests (desktop and phone) against the running stack, including accessibility, one-primary-action and touch-target checks |
| `make eval` | The golden question set through the real API as real users; prints pass/fail per case. `CASES=path` runs another set |
| `make lint` | Ruff, mypy (strict), Biome, TypeScript |
| `make check` | Everything CI runs |
| `make screenshots URL=…` | Retakes the README screenshots (stack running with `seed/sample`) |

The golden set ([`seed/sample/eval.json`](seed/sample/eval.json)) covers approved-versus-draft, reference notes, restricted content for the wrong group, the exact title of a restricted document, the right group, removed access, a planted AI instruction and "I don't know". Cases tagged `access` must never fail; CI runs them on every change.

## Go to production

**1. Prepare the server.** Docker with Compose v2.22+, a domain name, and a reverse proxy that terminates HTTPS (Caddy, nginx, Traefik or a cloud load balancer).

**2. Configure `.env`.** Start from `.env.example` and change at least:

```sh
THINQ_PORT=127.0.0.1:3000          # only the reverse proxy can reach the web app
THINQ_DEMO_MODE=false
THINQ_COOKIE_SECURE=true           # Secure cookies and HSTS; needs HTTPS
THINQ_TRUSTED_PROXY_HOPS=1         # reverse proxies in front (one here), so client addresses are right
POSTGRES_PASSWORD=<long random value>
COGNEE_PASSWORD=<long random value> # if you use Cognee
THINQ_SEED_PATH=/srv/thinq/data     # your folder, or ./seed/empty to start with setup
THINQ_SEED_PASSWORD=                # leave empty once people have their own passwords
THINQ_METRICS_TOKEN=<random value>  # optional: enables /api/metrics
```

**3. Put HTTPS in front.** For example, with Caddy (which gets certificates automatically):

```text
thinq.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

**4. Start.**

```sh
docker compose up -d --build --wait
```

Migrations run on start. Sign in as an Admin: the **Overview** lists any setting that is still unsafe for real use.

**5. Run it.**

| Task | How |
|---|---|
| Back up | `make backup` writes `backups/thinq-<timestamp>.sql.gz`; schedule it and copy the files off the server |
| Restore | `make restore FILE=backups/thinq-….sql.gz` (replaces current data) |
| Upgrade | `git pull && docker compose up -d --build --wait` (migrations run automatically) |
| Monitor | `GET /api/health` (readiness) and `/api/health/live`; Prometheus metrics at `/api/metrics` with `Authorization: Bearer <THINQ_METRICS_TOKEN>`; JSON logs with a request ID on every line |
| Watch quality | **Administration → Answer quality**: answer rate, "couldn't answer" rate, ratings, report resolution time, tokens and estimated cost |

Rate limits are per API process; behind several API processes, add a shared limit in the reverse proxy. Interactive API docs are off in production unless `THINQ_API_DOCS=true`. More in [OPERATIONS.md](OPERATIONS.md) and [SECURITY.md](SECURITY.md).

## Configuration

All settings are environment variables; [`.env.example`](.env.example) has the common ones and [`backend/app/core/config.py`](backend/app/core/config.py) the full list.

| Variable | Default | Purpose |
|---|---|---|
| `THINQ_PORT` | `3000` | Where the web app is published (`127.0.0.1:3000` for localhost only) |
| `THINQ_SEED_PATH` | `./seed/sample` | Folder with `users.csv`, `manifest.csv` and `documents/` |
| `THINQ_SEED_PASSWORD` | *(empty)* | First password for seeded users |
| `THINQ_DEMO_MODE` | `false` | One-click sign-in as anyone. Demos only |
| `THINQ_COOKIE_SECURE` | `false` | `true` behind HTTPS (also enables HSTS) |
| `THINQ_TRUSTED_PROXY_HOPS` | `0` | Reverse proxies in front of the web app |
| `POSTGRES_PASSWORD` | `thinq` | Database password |
| `THINQ_LLM_MODEL` | *(empty)* | Pydantic AI `provider:model`; empty = preview mode |
| `THINQ_LLM_FALLBACK_MODELS` | *(empty)* | Comma-separated fallback models |
| `THINQ_RETRIEVER` | `lexical` | `cognee` adds semantic search (with `COMPOSE_PROFILES=cognee`) |
| `COGNEE_PASSWORD` | `thinq-cognee` | Cognee service account password |
| `THINQ_SYNC_INTERVAL_S` | `300` | Folder sync schedule in seconds; `0` turns it off |
| `THINQ_REVIEW_PERIOD_DAYS` | `180` | When an approved document becomes "review overdue" |
| `THINQ_METRICS_TOKEN` | *(empty)* | Enables `/api/metrics` |
| `THINQ_API_DOCS` | off in production | Serve `/api/docs` |

Limits (`THINQ_API_REQUESTS_PER_MINUTE`, `THINQ_CHAT_QUESTIONS_PER_MINUTE`, `THINQ_REQUEST_MAX_BYTES`, `THINQ_UPLOAD_MAX_BYTES`) are described in [OPERATIONS.md](OPERATIONS.md).

## Project layout

```text
backend/            FastAPI app (app/), Alembic migrations, tests
  app/services/     access, documents (import, trust, sync), chat (retrieval, engines), knowledge, feedback
  app/eval.py       golden question runner (make eval)
frontend/           Next.js app (app/, components/, lib/), unit tests, e2e/ (Playwright)
seed/sample/        sample organization and its golden question set
seed/empty/         start with no people or documents (first-run setup)
screenshots/        README screenshots (make screenshots)
compose.yaml        the whole stack; compose.dev.yaml adds hot reload
```

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): how the pieces fit and where each rule lives
- [OPERATIONS.md](OPERATIONS.md): settings for real use, backups, monitoring, cost, limits
- [SECURITY.md](SECURITY.md): reporting vulnerabilities and how data is protected
- [CONTRIBUTING.md](CONTRIBUTING.md): ground rules and development setup

## License

[Apache License 2.0](LICENSE). Illustrations on the public pages are [Open Doodles](https://www.opendoodles.com) by Pablo Stanley, CC0.
