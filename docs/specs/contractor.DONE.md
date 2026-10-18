# apps/contractor — DONE (2026-10-17)

Ported onto `@homefax/db` + `@homefax/app-kit`, every existing screen kept, the
five hand-off features added. Nothing committed. No `npm install` was run.

## What was built

### The port

- **Deleted** `src/lib/accounts.ts`, `src/lib/auth.ts`, `src/lib/store.ts`,
  `src/lib/db/` (and every import of them). `src/lib/storage.ts` kept as is.
- **New `src/lib/session.ts`** — `currentUser = kit.currentPrincipal`;
  `orgContext(tx, me)` / `activeOrg(tx, me)` read the `hfx_org` cookie against
  `orgs.listOrgsForIdentity` inside the page's own actor transaction;
  `setActiveOrgCookie`; `homeownerAppUrl()` (`HOMEOWNER_APP_URL`, default
  `http://localhost:3001`).
- **New `src/lib/legacy-keys.ts`** — `accessKeys()` / `verifyKey()` moved here
  verbatim (id = first 12 chars of the secret, as before).
- **New `src/lib/show-once.ts`** — the show-once cookie pattern, shared by reset
  links (`hfx_reset_link`, path `/team`) and claim codes (`hfx_claim_code`, path
  `/records`).
- **New `src/lib/address.ts`** — `streetOf` / `cityLineOf` / `formatDate` so
  every page names a house the same way (street line as the title, city line in
  mono beneath).
- **`src/lib/pipeline.ts`** — `advanceCapture(id)` now runs on
  `records.getCapture` → `pollRecon` → `analyzeStage` → `evaluateCheckpoints`
  → `buildQualityReport` → `takeoffFromGeometry` → `records.finalizeCapture`
  (service) / `records.failCapture`. Intermediate state updates use
  `records.updateCapture`. Everything in it is `withService` because it is the
  named reconstruction pipeline; the API routes check `canBuild` as the actor
  first.
- **`src/app/api/captures/route.ts`** (POST) and **`[id]/route.ts`** (GET) —
  `kit.currentPrincipal()` → `withActor` → record/capture lookup under RLS →
  `canBuild(tx, propertyId)` (403) → then `submitRecon` + `records.upsertCapture`
  as the actor (with `filmedBy` / `filmedByOrgId`), or `advanceCapture`.
  `api/blob/upload` uses the principal's identity id in the token payload.
- **`src/app/account/actions.ts`** — every action rewritten on the repos with
  the `str/optStr/bool` helpers, `fail(path, errorMessage(e))` on failure.
  - sign-up/sign-in: `auth.signUp` / `auth.signIn` (service) + `kit.clientInfo()`
    for IP/UA + `kit.setSessionCookie`. `signIn` results handled: `locked` →
    "Too many attempts — try again in N minutes", `suspended`, `bad_credentials`
    → "That email and password do not match".
  - sign out → `kit.signOut()`; **new** `revokeOtherSessionsAction` →
    `auth.revokeOtherSessions` as the actor (`sessions_self_revoke` allows it).
  - change password → `auth.changePassword` (service; credentials are
    service-only rows, and it verifies the current password itself).
  - reset links: owner/admin checks as the actor, then `auth.createPasswordReset`
    (service); shown once via the cookie; `/reset` uses `auth.findPasswordReset`
    and `resetPasswordAction` runs `auth.consumePasswordReset` + `auth.startSession`.
  - company: `orgs.createOrg({kind:"contractor"})`, `orgs.updateOrg`,
    `orgs.regenerateHfxKey`, all as the actor. Owner/admin role checks kept
    for the same copy as before; RLS still binds underneath.
  - members: `orgs.findIdentityIdByEmailOrHandle` (service lookup) then
    `orgs.addMember` (actor insert); `orgs.removeMember`.
  - legacy claim: role check → `verifyKey` → `records.claimLegacyRecords`
    (service) → `/records?claimed=N` (the list now prints that line).
  - project team: `records.getRecord` + `canBuild` as the actor, then
    `records.addOrgToRecordByKey` (service, per its doc comment).
  - assignments: `records.createAssignment` / `grantRecordAccess` /
    `setAssignmentStatus` as the actor.
  - hires: `records.createHire` as the actor; decline →
    `records.setHireStatus`; accept → **`records.acceptHire`** (new, service —
    see packages changes).
- **`src/app/records/actions.ts`** — `createRecordAction` takes `address`
  (street line *or* a whole one-line address via `parseAddressLine`), `line2`,
  `city`, `state`, `zip`, `owner`; `properties.findOrCreateProperty` (service)
  then `records.createRecord` (actor). New `issueClaimCodeAction`,
  `requestDrawAction`.
- **Pages** — layouts untouched, data sources swapped, all reads through
  `kit.asMe` in one transaction per page:
  - `/` — `kit.currentPrincipal()`; password copy "Ten characters or more",
    `minLength={PASSWORD_MIN}` (10, from `@homefax/auth`).
  - `/records` — `records.listRecordsForOrg` (+ `records.stageStatuses` for the
    comb); the strip is summed from `property_stats`; assignments from
    `records.listAssignmentsForIdentity`; the start-a-record form gained Unit /
    City / State / ZIP, prefilled from the org's most recent record (default
    Bentonville / AR / 72712).
  - `/records/[slug]` — `records.getRecordBySlug` → `viewProperty(...)` (404 on
    null; the look is logged). Ledger totals from the stats row. Plus the two
    new panels (below).
  - `/records/[slug]/stages/[stage]` — same gate; capture from
    `records.listCaptures`; `simulated` = `glbUrl.startsWith("procedural://")`.
    Plus the draw panel (below).
  - `/hire` — `people.listPublicProfiles`, `orgs.listPublicOrgs(["contractor",
    "inspector"])`, `records.listIncomingHires` / `listHiresFromOrg`, names via
    `orgs.getOrgsByIds` / `records.namesFor`.
  - `/team` — `orgs.getMembership`, `orgs.listMembers` (`{membership, profile}`);
    the legacy-claim panel keys off `org.legacyKeyId === null`.
  - `/profile` — `me.profile`, `orgs.listOrgsForIdentity` (carries the role),
    `auth.listSessions` as the actor; password copy says ten characters.
  - `/reset` — `auth.findPasswordReset` (service).
- **`scripts/issue-reset-link.ts`** — on `auth.getIdentityByEmail` +
  `auth.createPasswordReset` under `withService`; loads `.env.local` itself
  (`loadEnv` is not exported from `@homefax/db`'s index and I did not want to
  widen the package surface for a script).

### The five new features

1. **Hand the house to its owner** — "Homeowner" panel on the record page:
   current owners from `properties.listOwners` (name, handle, since, role chip)
   or "Not claimed yet"; count of codes issued but unused
   (`properties.listOwnerInvites`); "Issue a claim code" →
   `properties.createOwnerInvite` → the code on an onyx plate, shown once via
   the cookie, with "Go to `<HOMEOWNER_APP_URL>/claim` and enter XXXX-XXXX",
   and "Done, hide the code". The button is always there (primary when
   unclaimed, secondary when an owner exists — a co-owner or the next owner can
   be handed a code too), which is also what lets the smoke test issue one on
   Ridgemont, which the seed already gave to Rupali.
2. **Who can see this record** — read-only panel: `access.listGrants` (grantee,
   scope chip, purpose, granted/until), `access.listRequestsForProperty(...,
   "pending")` ("Asking for ledger · waiting on the owner"), and
   `orgs.municipalitiesCovering(tx, property)` ("Covers Bentonville, AR by
   statute", ledger chip). `municipalitiesCovering` already existed in
   `packages/db` — nothing had to be added for it.
3. **Draw requests** — on a filmed stage, when `oversight.listDrawsForProperty`
   returns rows the panel "Construction draw" lists this stage's draws (amount,
   status chip, decision note), shows `oversight.recommendDraw`'s reading ("The
   record says: hold — …"), and "Request draw for this stage" →
   `oversight.requestDraw`. On an unfilmed stage it says a lender is on file and
   the draw can be requested once the stage is graded.
4. **Sign out + sessions** — "Signed in on N devices" on `/profile` (device
   family from the user agent, app, last seen, IP, "This device" chip) with
   "Sign out everywhere else" → `auth.revokeOtherSessions`, and the existing
   Sign out (now `kit.signOut()`, which revokes the session row).
5. **Password minimum 10** — `PASSWORD_MIN` from `@homefax/auth` on `/`,
   `/profile`, `/reset`; copy says "Ten characters or more".

### Tests

`tests/smoke.test.ts` (node:test + playwright-core, Chromium at
`/usr/bin/chromium` with the brief's flags, 390×844): signs in as
`arjun@demo.homefax`, checks the stats strip, opens the Ridgemont record and its
hand-off panels (incl. "City of Bentonville"), issues a claim code and sees it
once (and gone after "Done"), opens the framing stage and asserts the grade
stamp's `aria-label` plus the draw panel, checks the profile's session list,
signs out, and asserts no page errors. `BASE_URL` / `CHROMIUM_PATH` overridable.
Each run leaves one unused `owner_invites` row on Ridgemont (by design of the
spec's flow).

I also browser-walked the mutation paths not in the smoke test (bad password
copy, the lockout copy after 5 failures on a throwaway email, record creation
from a one-line address, assign work + mark done, a bogus HomeFAX key, a draw
request, profile update round-trip, 404 for an unknown slug and stage) — all
behaved; the probe rows were deleted afterwards (see "DB note").

## packages/* changes (additive only)

- `packages/db/src/repos/records.ts` — **`acceptHire(tx, {hireId, identityId,
  adminOrgIds})`**, a service-level function with a doc comment: when the
  addressee accepts an offer that names a property they hold no build rights
  on that record yet, so under RLS they could not insert the assignment or seat
  their company on the project team themselves. The app verifies the actor is
  the addressee first; the function re-checks it. `npm test -w @homefax/db`:
  14/14 pass.
- (`packages/db/src/repos/auth.ts` also shows a diff — `checkPassword` — that is
  **not** mine; it belongs to one of the other apps' engineers.)

## Skipped / caveats

- **Draw panel visibility** depends on existing draws: a contractor cannot read
  `portfolio_holdings` (the policy is lender-or-owner only, by design), so the
  only way to learn the `holdingId` `requestDraw` needs is from
  `listDrawsForProperty`. A lender that holds a loan but has never had a draw
  requested against it is invisible to the contractor, and the panel stays off.
  Adding a service-level "which lender holds this house" lookup would leak a
  relationship the RLS deliberately scopes to the owner, so I did not.
- **Grantee names** in "Who can see this record" fall back to "An institution"
  for non-public orgs (e.g. First Ozark Bank, Ozark Mutual): `organizations_read`
  only opens a grantee org's row to the property *owner*. Scope, purpose and
  dates still show; the municipality shows by name (public).
- **Hire board companies** are filtered to kinds `contractor` and `inspector`
  (the old board listed every public org; the new world also has public
  municipalities and brokerages, which a contractor does not hire).
- **Legacy claim**: the seeded legacy record carries `legacy_key_id =
  'hfx-dev-key'`, while `verifyKey` derives ids as the first 12 chars of the
  `ACCESS_KEYS` secret (unchanged behaviour), so the UI will not match that
  particular seed row. Real imports from the old store use the same derivation
  as before.
- **404 status**: `notFound()` renders Next's 404 UI, but because `loading.tsx`
  streams the shell first the HTTP status is 200 in dev (pre-existing
  behaviour; the brief asks for `notFound()`, which is what runs).
- The `.data/store.json` file was left in place — `npm run db:import-legacy`
  still reads it. No code references it.
- `nanoid` is now unused by the app but still listed in `package.json` (no
  `npm install` run).

## DB note for the other engineers

While cleaning up my verification rows I deleted the unclaimed `owner_invites`
too broadly and removed the seed's five claim codes as well as my own. I
re-issued one for each unowned demo house with
`packages/db/scripts/issue-claim-code.ts`; use these in the homeowner app:

| House | Claim code |
|---|---|
| 905 SW Walton Blvd, Bentonville | `NG28-EYUT` |
| 310 SE J St, Bentonville | `W8FW-4U7R` |
| 1200 NW 3rd St, Bentonville | `WGT7-E99F` |
| 88 Pinnacle Hills Pkwy, Rogers | `ZDEP-MNNP` |

(Each valid 30 days, one use. Everything else in the demo world is as seeded.)

## Final commands (all run inside `apps/contractor` unless noted)

```
npx next typegen && npx tsc --noEmit     → "✓ Types generated successfully", tsc exit 0
npm run lint                             → eslint, 0 errors, 0 warnings, exit 0
npm run build                            → ✓ Compiled successfully in 8.7s; all app routes ƒ (dynamic), exit 0
npm run dev -w @homefax/contractor (background, from the repo root) then
npm test -w @homefax/contractor          → 8 tests, 8 pass, 0 fail (7.7 s)
npm test -w @homefax/db (repo root)      → 14 tests, 14 pass, 0 fail
```

Dev server stopped afterwards (`kill $(lsof -ti :3000)`).
