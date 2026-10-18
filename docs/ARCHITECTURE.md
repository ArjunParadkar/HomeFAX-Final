# HomeFAX platform — architecture

A permanent record of how a home was built, read by five kinds of people.

```
apps/contractor   phone-first   film each stage → measured 3D model, graded inspection, parts list
apps/homeowner    phone-first   the house's record: grades, models, what is in the walls, who may see it
apps/admin        desktop       institutions: municipality · lender · insurer · brokerage
packages/core     the domain: 11 stages, 50-point ledger, rubric, catalogue, recon + vision clients
packages/ui       the design system: permit card / grade stamp components, brand marks, tokens
packages/db       Postgres schema, row-level security, repositories, stats, seed, import
packages/auth     scrypt, opaque tokens, sessions, field encryption, lockout math
services/recon    the GPU photogrammetry worker (unchanged)
```

One identity signs into any app it has a role in. Each app keeps its own session
cookie (`hfx_session`, `hfx_owner_session`, `hfx_admin_session`) because they are
different sites; the sessions table knows which app each row belongs to.

## Request flow

```
browser ──cookie──▶ app route ──resolveSession (service tx)──▶ Principal
                       │
                       └─▶ withActor({identityId}, tx => repos…)   ← RLS decides visibility
                       └─▶ withService(tx => …) only for sign-in, claims, the pipeline
```

Pages are server components; mutations are server actions that redirect back
with `?error=` on failure (the convention the contractor app established).

## The house is the centre

A `property` is created once (deduplicated by normalised address) and everything
hangs off it: build records from contractors, ownership periods, grades flattened
from each filmed stage, grants to institutions, loans, policies, permits,
listings, a timeline, documents, and a stats row that triggers keep current.

Access is a ladder — summary → ledger → full — and `packages/db/README.md`
has the exact table-by-table rules.

## Deployment

Three Vercel projects from one repository (Root Directory `apps/<name>`), one
Neon Postgres. See `docs/DEPLOY.md`.
