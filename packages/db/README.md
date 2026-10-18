# @homefax/db

The HomeFAX platform database: one Postgres, seven schemas, row-level security
on every table, and typed repositories the three apps call.

```
withActor(actor, tx => …)    run as a person (or an anonymous visitor)
withService(tx => …)         run as the platform — sign-in, the pipeline, imports
scopeOf(tx, propertyId)      'summary' | 'ledger' | 'full' | null for the current actor
```

Every repository function takes the transaction first and never opens its own,
so a page can do several reads in one actor context:

```ts
import { withActor, properties, records, access } from "@homefax/db";

const data = await withActor({ identityId: me.id }, async (tx) => {
  const home = await properties.getPropertyBySlug(tx, slug);
  if (!home) return null;                       // RLS already hid what I may not see
  return {
    home,
    stats: await properties.getStats(tx, home.id),
    stages: await records.stageStatuses(tx, home.id),
    grants: await access.listGrants(tx, home.id),
  };
});
```

## The model

| Schema | Holds | Why it is separate |
|---|---|---|
| `auth` | identities, **credentials**, sessions, login attempts, password resets | who you are vs. how you prove it. A read of `identities` never yields a hash. Sessions are rows: revocable, per app, sliding expiry. |
| `people` | profiles (name, handle, headline, bio, encrypted phone) | what you *show*, editable without touching auth |
| `org` | organizations (kind: contractor / lender / insurer / municipality / brokerage), memberships, invitations, **jurisdictions** | one org model for every institution; a municipality's jurisdictions define its statutory view |
| `property` | **properties** (normalised address, dedup key), owners over time, owner invites (claim codes), **property_stats**, events (the timeline), documents | the house outlives any contractor, owner or loan |
| `build` | records, record_access (project team), captures, **stage_grades, checkpoint_results, findings, part_lines** (flattened from the capture's JSON), assignments, hires | the construction record; flattened rows make portfolios queryable |
| `access` | grants, access_requests, share_links, **access_log** | who outside the project may see a house, by which path, and every look they took |
| `oversight` | portfolio_holdings + loan_draws, policies, listings, permits, inspection_reviews | the institutions' relationships to houses |
| `audit` | audit_log (append-only, trigger-fed, secrets redacted) | who changed what |

Ids are 12-char nanoids made in the app (`newId()`). Timestamps are `timestamptz`.
Enumerations are `CHECK` constraints on text so they can grow without a type migration.

## Who sees what

`app.property_scope(property_id)` in the database is the single source of truth.
It returns the actor's widest scope on a house, or NULL:

| Path | Scope | Rule |
|---|---|---|
| **owner** | full | a current row in `property_owners` |
| **project** | full | member of an org on the record's `record_access` |
| **grant** | as granted | a live, unexpired row in `access.grants` to the actor or their org |
| **jurisdiction** | ledger | member of a `municipality` whose `jurisdictions` cover the house's state + (city / county / ZIP) |
| **share link** | as the link | `app.share_hash` setting matches a live `share_links` row |
| **service** | full | `app.role = 'service'` |

The scope ladder decides which tables are readable:

| Needs | Tables |
|---|---|
| summary | properties, property_stats, records, stage_grades, permits, the summary-visibility events |
| ledger | + captures (models, frames), checkpoint_results, findings, inspection_reviews |
| full | + part_lines, property_documents, full-visibility events |

Writes: only the project team films (`app.can_build`); only owners grant; only an
institution's members write its holdings / policies / listings / permits; only
municipality members review. RLS refuses anything else with
`new row violates row-level security policy` — the repositories surface that as
an error, they never silently drop a write.

`access.reach(tx, propertyId, actor)` gives the same answer as the database plus
the *path* (`via`), so pages can call `access.logAccess` for non-owner views.

## Connections and roles

| Variable | Role | Used by |
|---|---|---|
| `DATABASE_URL` | owner | migrations, imports, seed, tests |
| `DATABASE_APP_URL` | `homefax_app` (no DDL, no BYPASSRLS) | the three apps at runtime |
| `PII_ENCRYPTION_KEY` | 32 bytes base64 | phone numbers, loan and policy references (AES-256-GCM, app side) |

If `DATABASE_APP_URL` is absent the apps fall back to `DATABASE_URL`. Every table
has `FORCE ROW LEVEL SECURITY`, so the policies bind to the owner too — the
separate role is defence in depth (no DDL from a compromised app), not the thing
RLS depends on.

```bash
npm run db:migrate                       # apply migrations/*.sql not yet in public.hfx_migrations
APP_ROLE_PASSWORD=… npx tsx packages/db/scripts/create-app-role.ts   # give homefax_app a password
npm run db:seed                          # the demo world (see src/seed-world.ts)
npm run db:import-legacy -- --file apps/contractor/.data/store.json  # or from the old `homefax` schema
npm run test -w @homefax/db              # needs the local Docker Postgres (see tests/helpers.ts)
```

Migrations are hand-written SQL, applied in a transaction each, checksummed —
a changed file that was already applied stops the run. Add a new file instead.

## Conventions worth knowing

- **RETURNING re-checks the SELECT policy.** If a writer may hold less scope than
  the row they insert (a lender deciding a draw adds a `full` event), do not use
  `.returning()` — see `properties.addEvent`.
- **Service calls are named loudly.** `withService` is the escape hatch; every
  caller must have authorised the action first. The repos that need it say so in
  their doc comment (`signIn`, `claimProperty`, `requestAccess`, `resolveShareLink`,
  `addOrgToRecordByKey`, `findOrCreateProperty`).
- **Stats are derived.** Never write `property_stats`; call
  `properties.recomputeStats` (the triggers already do after grades and reviews).
- **Events are the homeowner's story.** Add one for anything a person would want
  on the house's timeline, with the right `visibility`.
