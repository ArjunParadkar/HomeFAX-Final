# apps/contractor — port to the platform + hand-off features

The live contractor app (`apps/contractor`) still runs on its own `src/lib/
{accounts,auth,store,db,storage,pipeline}.ts` against the old `homefax` schema
and a JSON file. Port it onto `@homefax/db` + `@homefax/app-kit` **without
changing what a contractor sees**, then add the hand-off features below.

## Port

Delete `src/lib/accounts.ts`, `src/lib/auth.ts`, `src/lib/store.ts`,
`src/lib/db/`. Keep `src/lib/storage.ts` (Blob) and `src/lib/frames.ts` is
already in core. Rewrite:

- `src/lib/kit.ts` exists (`createAppKit("contractor")`). `src/lib/session.ts`:
  `currentUser()` → `kit.currentPrincipal()`; `activeOrg(me)` reads the `hfx_org`
  cookie and `orgs.listOrgsForIdentity`.
- `src/app/account/actions.ts`: every action onto the repos. Sign-up/in via
  `auth.signUp/signIn` (service) + `kit.setSessionCookie`. Handle
  `signIn` results: `locked` → "Too many attempts — try again in N minutes".
  Password change → `auth.changePassword`; reset links → `auth.createPasswordReset`
  (keep the show-once cookie flow and the `/reset` page via `consumePasswordReset`).
  Company → `orgs.createOrg({kind:"contractor"})`; members → `orgs.addMember`
  after `findIdentityIdByEmailOrHandle` (service lookup, actor insert); hfx key
  regenerate; claim legacy records → `records.claimLegacyRecords` (service, after
  `verifyKey` against `ACCESS_KEYS` — move `accessKeys/verifyKey` into
  `src/lib/legacy-keys.ts`). Hires/assignments → repos.
- `src/app/records/actions.ts`: creating a record now creates/finds the
  **property** first. The form gains City / State / ZIP fields (defaults
  Bentonville / AR / 72712 prefilled from the org's last record), or accepts a
  one-line address via `parseAddressLine`. `properties.findOrCreateProperty`
  (service) then `records.createRecord` (actor).
- `src/lib/pipeline.ts` → `advanceCapture(id)` uses `records.getCapture`,
  `pollRecon`, `analyzeStage`, `evaluateCheckpoints`, `buildQualityReport`,
  `takeoffFromGeometry`, then `records.finalizeCapture` (service) or `failCapture`.
  The API routes check `canBuild(tx, propertyId)` as the actor before advancing.
- Pages: `/records` (stats from `property_stats` now), `/records/[slug]`,
  `/records/[slug]/stages/[stage]`, `/hire`, `/team`, `/profile`, `/reset`, `/`.
  Keep the layouts; swap data sources. Record slug = `build.records.slug`.
- `scripts/issue-reset-link.ts` → repos.

## New

1. **Hand the house to its owner.** On the record page, a "Homeowner" panel:
   current owner (from `properties.listOwners`) or "Not claimed yet" with
   "Issue a claim code" → `properties.createOwnerInvite` → show the code once on
   an onyx plate (same show-once cookie pattern as reset links) with the text the
   contractor reads to the homeowner: "Go to <homeowner app URL>/claim and enter
   XXXX-XXXX". `HOMEOWNER_APP_URL` env (default http://localhost:3001).
2. **Who can see this record.** A read-only panel listing grants, pending access
   requests, and the municipality covering the address (if any) — from
   `access.listGrants`, `access.listRequestsForProperty`, and a small repo
   helper you add: `orgs.municipalitiesCovering(tx, property)`.
3. **Draw requests.** If a lender holds a construction loan on the property
   (`oversight.listDrawsForProperty` returns rows / `portfolio_holdings` visible),
   the stage page shows "Request draw for this stage" → `oversight.requestDraw`.
   Contractors can request; lenders decide in the admin app.
4. **Sign out** on `/profile` and a session list ("Signed in on 3 devices") with
   "Sign out everywhere else" → `auth.revokeOtherSessions`.
5. Password minimum is now 10 and the hire board / profile copy says so.

## Done means

`npm run build`, lint, tsc clean; `tests/smoke.test.ts` signs in as
`arjun@demo.homefax`, opens `/records`, opens the Ridgemont record, opens the
framing stage, issues a claim code, and sees the grade stamp. Legacy file store
code is gone. Write `docs/specs/contractor.DONE.md`.
