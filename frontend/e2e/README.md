# End-to-end tests

They drive real browsers against the full stack (web, API, database).

```sh
docker compose up -d --build --wait        # from the repository root
pnpm exec playwright install chromium      # first time only
E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
```

The tests create their own users and groups with unique names, so they can run
repeatedly against the same database. They expect the seed data the stack was
started with; defaults match `seed/sample`. For another dataset set
`E2E_ADMIN_EMAIL`, `E2E_SEED_PASSWORD`, `E2E_MEMBER_NAME`, `E2E_MEMBER_GROUP` and
`E2E_OTHER_GROUP`.
