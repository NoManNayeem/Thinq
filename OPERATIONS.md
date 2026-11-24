# Running Thinq

## Before real use

Sign in as an Admin: the Overview lists any setting that is fine for a demo but unsafe for real
use. In short:

- `THINQ_DEMO_MODE=false` (one-click sign-in as anyone is for demos only).
- Change `POSTGRES_PASSWORD`, and `COGNEE_PASSWORD` if you use Cognee.
- Serve over HTTPS and set `THINQ_COOKIE_SECURE=true` (this also turns on HSTS).
- Leave `THINQ_SEED_PASSWORD` empty once people have set their own passwords.

On an empty installation with no seed folder, the sign-in page leads to a one-time setup that
creates the first Admin. It closes for good as soon as any user exists.

## Documents

Point `THINQ_SEED_PATH` at a folder with `documents/` (Markdown or text, sub-folders allowed) and
an optional `manifest.csv` ([format](seed/README.md)). Thinq syncs it on start and every
`THINQ_SYNC_INTERVAL_S` seconds (default 300; 0 turns the schedule off). Admins can sync now, see
the sync history and upload documents under **Administration → Sources and sync**.

## Backups

```sh
make backup                                   # writes backups/thinq-<timestamp>.sql.gz
make restore FILE=backups/thinq-....sql.gz    # replaces the current data
```

The `cognee` database (when used) can be rebuilt from Thinq at any time: Thinq re-sends every
document if its `knowledge_items` are cleared. Back it up the same way if rebuilding would take
too long for you.

## Upgrades

`docker compose pull && docker compose up -d --build --wait`. Database migrations run on start
under a lock, so several API containers can start together safely.

## Monitoring

- `GET /api/health` (readiness, database included) and `/api/health/live` (liveness).
- `GET /api/metrics` serves Prometheus metrics when `THINQ_METRICS_TOKEN` is set; send it as
  `Authorization: Bearer <token>`. It includes requests by status class, answers by engine,
  model tokens, estimated model cost, open feedback items and documents by status.
- Logs are JSON in production (`THINQ_LOG_JSON=true`) with a request ID on every line.
- **Administration → Answer quality** shows questions, answer and "couldn't answer" rates,
  ratings, report resolution time, tokens and estimated cost.

## Cost

Each answer records its input and output tokens and an estimated cost from the price list bundled
with Pydantic AI (0 for local models such as Ollama). The model is only called when the person can
see at least one relevant source. `THINQ_CHAT_QUESTIONS_PER_MINUTE` (default 12) caps questions
per person; `THINQ_LLM_MAX_OUTPUT_TOKENS` caps answer length.

## Limits

| Setting | Default | What it limits |
|---|---|---|
| `THINQ_API_REQUESTS_PER_MINUTE` | 600 | Requests per client IP (health checks excluded) |
| `THINQ_CHAT_QUESTIONS_PER_MINUTE` | 12 | Questions per person |
| `THINQ_REQUEST_MAX_BYTES` | 2 MB | Any request body |
| `THINQ_UPLOAD_MAX_BYTES` | 1 MB | Uploaded documents |
| `THINQ_LOGIN_MAX_FAILURES` | 5 per 15 min | Failed sign-ins per email and IP |

Rate limits are kept in memory per API process. Behind several API processes, put a shared limit
in your reverse proxy as well.
