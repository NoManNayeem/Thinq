# Seed data

On first start, Thinq loads `users.csv` from the folder set in `THINQ_SEED_PATH`
(default `./seed/sample`). It runs only while the database has no users, so an
Admin's later changes are never overwritten.

## users.csv

| Column          | Meaning                                                            |
|-----------------|--------------------------------------------------------------------|
| `user_id`       | Ignored. Kept so exports from other tools load unchanged.          |
| `name`          | Full name                                                          |
| `email`         | Sign-in email (stored lowercase)                                   |
| `title`         | Job title (optional)                                               |
| `role`          | `Member` or `Admin`                                                |
| `access_groups` | Semicolon-separated group names. `Everyone` is automatic.          |

Seeded users get the password in `THINQ_SEED_PASSWORD`, or no password when it
is empty (they can then sign in only through demo mode, or after an Admin sets one).

## Documents

`manifest.csv` and the `documents/` folder in the same seed folder are scanned on
every start (and when an Admin clicks **Re-scan sources**). Unchanged files are left
alone; changed files get a new version.

| Column          | Meaning                                                                 |
|-----------------|-------------------------------------------------------------------------|
| `doc_id`        | Your own short ID, e.g. `D01` (optional)                                 |
| `file_name`     | File name inside `documents/`                                           |
| `title`         | Readable title (defaults to the file's first `# heading`)               |
| `owner`         | Person responsible; linked to a user when the name matches              |
| `status`        | `Approved`, `Draft`, `Outdated`, `Reference`, or blank (unknown)         |
| `last_modified` | `YYYY-MM-DD`                                                            |
| `last_reviewed` | `YYYY-MM-DD`, when the owner last confirmed it's correct                |
| `access_group`  | The one group allowed to see it. Must be an existing group name         |

Files that aren't in the manifest are imported as **unregistered**: only Admins see
them until someone assigns an access group. After the first import Thinq is the
system of record — later manifest edits are shown to Admins as drift, not applied.
