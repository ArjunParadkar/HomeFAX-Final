# HomeFAX

**The permanent record of how a home was built — and who may read it.**

A contractor films each construction stage on a phone. HomeFAX turns the walk
into a measured 3D model, grades it against a 50-point ledger, and takes off the
materials. The record belongs to the house: the homeowner inherits it, and
lenders, insurers, the city, and agents read it at the scope the owner allows.

```
apps/contractor    film · grade · take off · hand the house over          (phone)
apps/homeowner     the house's record, access control, public report      (phone)
apps/admin         municipality · lender · insurer · brokerage workspaces (desktop)
packages/core      the 11 stages, the 50-point ledger, the rubric, the catalogue
packages/ui        the permit-card / grade-stamp design system
packages/db        Postgres schema · row-level security · repositories · seed
packages/auth      scrypt · opaque tokens · sessions · field encryption · lockout
packages/app-kit   Next.js glue: cookie → principal, actor transactions, forms
services/recon     the GPU photogrammetry worker
```

Start with `docs/ARCHITECTURE.md`, then `packages/db/README.md`. Operations are
in `docs/DATABASE.md` and `docs/DEPLOY.md`. Each app has its own README.

## Run it

```bash
npm install
npm run db:migrate && APP_ROLE_PASSWORD=homefax_app_dev npx tsx packages/db/scripts/create-app-role.ts
npm run db:seed                    # demo world; prints the accounts
npm run dev:contractor             # http://localhost:3000
npm run dev:homeowner              # http://localhost:3001
npm run dev:admin                  # http://localhost:3002
npm test                           # core · auth · db (needs the local Postgres) · app smoke tests (need dev servers)
```

## Security posture, in one paragraph

Identity, credentials and profile are separate tables. Sessions are server-side
and revocable; sign-in is throttled per email and per address. Every table is
under forced row-level security; the actor is a transaction-local setting and
the policies are the authorisation — the TypeScript cannot forget a `where`.
Access to a house is a ladder (summary → ledger → full) reached by ownership,
project membership, an explicit grant, municipal jurisdiction or a share link,
and every non-owner look is logged where the owner can read it. Sensitive
references are encrypted at rest; the audit log is append-only and redacts
secrets by trigger; the runtime role cannot alter the schema.
