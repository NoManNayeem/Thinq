# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting for this
repository ("Report a vulnerability" under the Security tab). We aim to reply within a week.

## How Thinq protects data

- **Sessions, not self-contained tokens.** The cookie holds a random token (HttpOnly, SameSite=Lax,
  Secure behind HTTPS); only its SHA-256 is stored. Groups and role are re-read on every request,
  so access changes and deactivation apply immediately.
- **One access rule.** Documents are visible only to members of their access group (Admins also see
  documents with no group). Hidden documents return 404, everywhere: library, search, versions,
  answers, sources, the knowledge graph, approvals, feedback and the Admin inspector.
- **The AI sees only what the asker can see.** Retrieval is filtered before anything is sent to a
  model; document text is framed as data; lines aimed at an AI assistant are removed; the model
  has no tools; citation numbers are verified.
- **Optional services aren't trusted.** Cognee results are re-checked against Thinq's access rule
  and current content before use.
- **Private conversations.** Only their owner can read them, Admins included. Audit events record
  which documents an answer used, never the question text.
- **Hardening.** Same-origin check on state-changing requests, security headers (CSP, frame
  denial, nosniff), request size limits, rate limits on sign-in, questions and API requests,
  Argon2 password hashing.
- **Feedback sharing is explicit.** Flagging an answer shares that question and answer with the
  document's owner (or Admins); people are told before they send it. Unanswered questions are
  shown to Admins without names.

See [OPERATIONS.md](OPERATIONS.md) for the settings to change before real use.
