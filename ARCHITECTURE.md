# Architecture

Thinq answers questions from an organization's documents, but only with documents that are
current, approved where possible, and visible to the person asking. This page explains how the
pieces fit and where each rule lives.

## Services

```
Browser ──► web (Next.js, :3000) ──/api/*──► api (FastAPI) ──► PostgreSQL 18 + pgvector
                                               │  ├─► AI provider (optional, Pydantic AI)
                                               │  └─► cognee (optional) ──► same PostgreSQL, "cognee" database
                                               └─ background: folder sync, knowledge sync
```

- **web** renders the UI and forwards `/api/*` to the API over the internal network. The browser
  never talks to the API directly, so there is no CORS and the session cookie stays first-party.
- **api** owns every rule: authentication, access, trust, auditing. It runs migrations and the
  initial import under a database lock on start.
- **cognee** is optional (compose profile `cognee`). It provides semantic search and extracted
  entities. It is never trusted with access decisions.

## The answer pipeline

Every question follows one fixed path. The model has no tools.

1. **Authorize.** The session is resolved and the person's groups are read from the database on
   every request (`app/api/deps.py`). Removing someone from a group applies to their next request.
2. **Retrieve.** Only documents from `visible_documents(principal)` are read
   (`app/services/documents/access.py`, the single place that decides visibility). Unregistered,
   missing and outdated documents are never used for answers. With Cognee on, semantic hits are
   mapped back to Thinq documents through Thinq's own `knowledge_items` table and accepted only if
   the person can see that document *now* and the indexed content is current.
3. **Rank by trust.** Lexical and semantic relevance are fused per document, then weighted:
   Approved 1.0, Reference 0.85, Unknown 0.7, Draft 0.5 (`app/services/chat/retrieval.py`).
   Drafts that matched but weren't cited, and excluded outdated versions, become notices.
4. **Generate.** Preview mode lists the most trusted excerpts. With `THINQ_LLM_MODEL` set, a
   Pydantic AI agent answers from the cited sources only (`app/services/chat/llm_engine.py`).
   Document text is framed as data, lines aimed at an AI assistant are removed first, and the
   person's earlier visible turns are the only history sent.
5. **Verify.** Citation numbers that don't match a source are dropped while streaming. If nothing
   the person can see supports an answer, the model isn't called at all.

Answers stream to the browser as an AI SDK UI message stream (Server-Sent Events).

## Trust and approval

`app/services/documents/trust.py`:

- Versions of a document form a *family* (derived from the title, overridable). The current
  member is the Approved one, whatever its date.
- Only the document's owner (when they have an account) or an Admin may change its status. Every
  change is recorded in `document_status_changes`.
- Approving a document retires the family's previous Approved version in the same transaction.
- An Approved document that names another as the one to use, or as retired, produces a
  *proposal*. A person always confirms it.
- An Approved document whose last review is older than `THINQ_REVIEW_PERIOD_DAYS` is flagged.

## Feedback loop

`app/services/feedback.py`: a "not helpful" answer creates one inbox item per cited document,
for its owner when they have an account and can see it, otherwise for Admins. The reporter sees
the outcome on the answer and under Feedback.

## Sources and sync

`app/services/documents/sync.py` and `importer.py`: a folder (sub-folders allowed) plus an optional
`manifest.csv`, synced on start, on a schedule and on demand. Renamed or moved files keep their
document; deleted files leave answers at once. Each sync is one transaction; a failure changes
nothing and is recorded for Admins. Admins can also upload documents directly.

## Quality

- `app/eval.py` runs a golden question set through the real API as real users
  (`make eval`). The public set is `seed/sample/eval.json`; CI fails on any failing case.
- The Admin quality dashboard reads live figures from answers and feedback; the retrieval
  inspector runs a question as any user without answering it, and never names documents the
  Admin can't see.

## Data model (main tables)

| Table | Holds |
|---|---|
| `users`, `groups`, `memberships`, `user_sessions` | People, access groups, sessions (token hashes only) |
| `documents`, `document_versions`, `document_flags` | Documents, every version, data-quality flags |
| `document_status_changes`, `status_proposals` | Approval history, evidence-based proposals |
| `conversations`, `chat_messages`, `message_sources`, `message_feedback` | Private chats, cited sources (snapshotted), ratings |
| `feedback_items` | Inbox items for owners and Admins |
| `knowledge_datasets`, `knowledge_items` | What Thinq sent to Cognee, per access group |
| `audit_events` | Who did what, when (never question text) |
