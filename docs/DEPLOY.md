# Deploying the platform

Three Vercel projects, one GitHub repository (`ArjunParadkar/HomeFAX-Final`),
one Neon Postgres. Each project's **Root Directory** is its app folder; Vercel
installs the workspace from the repository root and builds the one app.

| Project | Root Directory | Suggested domain | Session cookie |
|---|---|---|---|
| `homefax-final` (exists, live) | `apps/contractor` | homefax-final.vercel.app → app.homefax… | `hfx_session` |
| `homefax-owner` (new) | `apps/homeowner` | owner.homefax… | `hfx_owner_session` |
| `homefax-admin` (new) | `apps/admin` | institutions.homefax… | `hfx_admin_session` |

## Environment variables

Shared by all three (Production + Preview):

| Key | Value |
|---|---|
| `DATABASE_URL` | Neon owner connection string (migrations run with this; apps fall back to it) |
| `DATABASE_APP_URL` | `postgres://homefax_app:<secret>@<neon host>/<db>?sslmode=require` after `create-app-role` |
| `PII_ENCRYPTION_KEY` | 32 random bytes, base64 — the same value everywhere |
| `BLOB_READ_WRITE_TOKEN` | the existing `homefax-captures` Blob store (homeowner documents use it too) |
| `HOMEOWNER_APP_URL` | the homeowner app's public origin (used for claim-code text and buyer-report links) |

Contractor only: `ANTHROPIC_API_KEY`, `RUNPOD_API_KEY`/`RUNPOD_ENDPOINT_ID` or
`RECON_URL`/`RECON_KEY`, `ACCESS_KEYS` (only for claiming pre-platform records).
`AUTH_SECRET` is no longer read — sessions are database rows.

## Order of operations

1. **Database first** (safe while the old app is live — it adds schemas next to
   `homefax.*` and never touches them):
   ```bash
   DATABASE_URL=<neon owner url> npm run db:migrate
   DATABASE_URL=<neon owner url> APP_ROLE_PASSWORD=<new secret> npx tsx packages/db/scripts/create-app-role.ts
   DATABASE_URL=<neon owner url> PII_ENCRYPTION_KEY=<key> npm run db:import-legacy -- --default-city Bentonville --default-state AR --default-zip 72712
   ```
2. **New projects.** Create `homefax-owner` and `homefax-admin` from the same
   repository with the root directories above, set the variables, deploy. They
   read the imported data immediately; the live contractor app is untouched.
   ```bash
   vercel --scope arjunparadkar35-2025s-projects project add homefax-owner
   vercel api /v9/projects/homefax-owner --method PATCH --input '{"framework":"nextjs","rootDirectory":"apps/homeowner"}'
   # repeat for homefax-admin with apps/admin, then connect the Git repo in the dashboard (or `vercel git connect`)
   ```
3. **Contractor cutover.** Re-run the import (picks up anything new), then
   switch `homefax-final`'s Root Directory to `apps/contractor` and push the
   `platform` branch to `main`. Signed-in sessions from the old cookie are not
   valid any more — people sign in again with the same password (old hashes
   verify and are upgraded on first sign-in).
   ```bash
   vercel api /v9/projects/prj_nXbuQSFrRRArLafdiUJdfJlhNeyR --method PATCH --input '{"rootDirectory":"apps/contractor"}'
   git push origin platform:main
   ```
4. After a week: `DROP SCHEMA homefax CASCADE;` and remove `ACCESS_KEYS`.

## Preview deployments

Every push to a non-main branch previews all three projects. Point previews at a
Neon **branch** (not production) via Preview-scoped `DATABASE_URL`/`DATABASE_APP_URL`,
and seed it with `npm run db:seed` so reviewers have the demo world.

## Local

```bash
docker start homefax-db            # postgres:16 on :5432 (already provisioned)
npm install
npm run db:migrate && APP_ROLE_PASSWORD=homefax_app_dev npx tsx packages/db/scripts/create-app-role.ts
npm run db:seed
npm run dev:contractor   # :3000
npm run dev:homeowner    # :3001
npm run dev:admin        # :3002
```

Demo accounts are printed by the seed (password `homefax-demo-2026`).
