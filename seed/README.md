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
