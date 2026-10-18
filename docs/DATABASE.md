# Database — operating notes

Read `packages/db/README.md` for the model and access rules. This file is what
to do with it.

## Local

A `postgres:16` container named `homefax-db` runs on :5432. The platform uses the
`homefax_platform` database; tests create `homefax_platform_test_*` databases.

```bash
# packages/db/.env.local
DATABASE_URL=postgres://homefax:<pw>@localhost:5432/homefax_platform
DATABASE_APP_URL=postgres://homefax_app:homefax_app_dev@localhost:5432/homefax_platform
PII_ENCRYPTION_KEY=<32 bytes base64>      # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm run db:migrate
APP_ROLE_PASSWORD=homefax_app_dev npx tsx packages/db/scripts/create-app-role.ts
npm run db:seed
```

Apps read the same three variables (plus their own) from `apps/<app>/.env.local`.

## Production (Neon)

1. `DATABASE_URL` = the Neon owner connection. Run `npm run db:migrate`. It
   creates the schemas beside the legacy `homefax` schema — nothing in the old
   schema is touched, so the live contractor app keeps working.
2. `APP_ROLE_PASSWORD=<new secret> npx tsx packages/db/scripts/create-app-role.ts`,
   then set `DATABASE_APP_URL` in every Vercel project to
   `postgres://homefax_app:<secret>@<neon host>/<db>?sslmode=require`.
3. Set `PII_ENCRYPTION_KEY` (same value in all three projects). Losing it loses
   phone numbers and loan/policy references; nothing else.
4. `npm run db:import-legacy -- --default-city Bentonville --default-state AR --default-zip 72712`
   copies users, companies, records, captures, team and hires from `homefax.*`.
   Re-runnable: it skips rows that already exist by id. Run it once before the
   new apps go live and once more right before the contractor cutover.
5. Cut the contractor project over (Root Directory → `apps/contractor`). From then
   on both schemas exist but only the platform schemas are written. Drop the
   `homefax` schema after a week of clean operation.

## Backups and retention

Neon keeps point-in-time history; the audit log is append-only inside the
database and should be exported monthly (`COPY audit.audit_log TO …`). Login
attempts can be pruned after 30 days; sessions after they expire; nothing else
is ever deleted — identities are tombstoned (`auth.eraseIdentity`).

## Adding a migration

Write `packages/db/migrations/000N_name.sql`. Keep it to DDL and data fixes that
are safe to run once. Mirror the change in `packages/db/src/schema/*.ts`. Run
`npm run test -w @homefax/db` — the tests rebuild a database from the migration
files, so a schema/TS mismatch shows up there.
