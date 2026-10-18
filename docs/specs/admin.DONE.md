# apps/admin — DONE (2026-10-17)

The institutions' workspace, built from the scaffold per `docs/specs/admin.md`.
Four workspaces (municipality · lender · insurer · brokerage) in one Next.js 16
app on port 3002, laid out as the "ledger room": a fixed left rail (wordmark,
org switcher, sections, the person), a wide content column with a title row,
dense mono `.ledger` tables, paper cards for the record, onyx `.plate` for the
model viewer and the sign-in gate. Collapses to one column below 1024px.

## What was built

**Shared (every kind)**
- `/` — landing + sign-in / create-account as two links (`?mode=`). Signed-in → `/dashboard`, no institution → `/onboard`.
- `/onboard` — "Register your institution": name, four kind cards, headline; municipalities add their first jurisdiction. Runs as the actor (`orgs.createOrg` + `orgs.addJurisdiction` in one tx); sets the active-org cookie.
- Org switcher in the rail (`hfx_admin_org` cookie, membership re-checked on switch); "Register another institution".
- `/dashboard` — kind-specific (below).
- `/properties` — **the board** (`oversight.listReachableProperties`, RLS-filtered) + address search (`properties.searchProperties`) + grade / stage / status filters + the "Request access to a property" form (`parseAddressLine` → `properties.findByAddress` as service → `access.requestAccess` as service, only after confirming the actor's membership of the requesting org under RLS).
- `/properties/[slug]` — `viewProperty` first (404 when null; every look logged). Header with address/owner/builder, grade chip, risk word; 8 stat `.field`s; the 11-tick comb; "You see this house via grant (ledger) · granted 3 Oct by …" access line; tabs by scope: Overview (stages table with municipality verdicts + `riskProfile` reasons), Ledger (`QualityPanel` per stage), Findings, Models (shared `ModelViewer` on the plate, labelled "Simulated stand-in · not a reconstruction" for `procedural://` / simulated grades), Materials (full scope, `PartsTable`), Permits, Draws (lender: decide + record a request), Policies + Underwriting (insurer: `categoryBreakdown` + open findings), Listing (brokerage), Timeline (`listEvents`, RLS-trimmed).
- `/requests` — the org's requests with withdraw. See packages note below: a pending request is on a house the actor cannot see, so the list uses a new documented service read.
- `/team` — members (role change, remove, transfer ownership), invite by link (`orgs.createInvitation`; URL `<origin>/join/<token>` shown once via a 10-minute cookie), open invitations with revoke, institution profile (`updateOrg`), jurisdictions CRUD for municipalities.
- `/join/[token]` — invitation lookup/accept as the service (per repo docs); sign-in/sign-up forms carry `next` so the invitee comes straight back.
- `/audit` — `audit.listAuditForOrg` via `describeAudit` + `access.listAccessLogForOrg` (every look the org's members took).
- `/account` — profile (phone encrypted), password, sessions (revoke one / all others), sign out.

**Municipality** — dashboard tiles (in jurisdiction, filmed this quarter, awaiting review, flagged), `gradeHistogram` stacked bar, `stageCompletion` bars, the inspection queue; `/jurisdiction` board with filters + `/jurisdiction/export` (route handler streaming `text/csv`, same filters as the grid); `/permits` list / create / status + link to a build record (`records.listRecordsForProperty`); `/inspections` queue with "Include reviewed" toggle + history; `/inspections/[captureId]` review room: model on the plate, `QualityPanel`, keyframes, measured dimensions, three verdict buttons + note + optional permit (`recordInspectionReview`).

**Lender** — dashboard tiles (holdings, principal outstanding `$`, draws awaiting, elevated/high risk), risk-band bar, stage completion, the **draw queue** with the stored recommendation *and* a live `recommendDraw`, Release / Hold / Reject + note (`decideDraw`); `/portfolio` board + ledger (loan refs encrypted, shown `••••0418` via `oversight.dec`), add holding (property picker from reachable houses), status; `/draws` ledger with status/stage filters + record a request; `/draws/[id]` with the reasons and the basis capture's `GradeStamp`.

**Insurer** — dashboard tiles (policies by status, coverage in force, houses with open moisture/safety items, renewals in 60 days), policies-by-status bars, the **underwriting board** (7-row category mini table + risk band per house); `/policies` board + ledger + create (reference encrypted) + status; property page gains Underwriting.

**Brokerage** — dashboard tiles (active, under contract, sold, median list price) + listing board with buyer-report status; `/listings` board + ledger + create (agent = a member); `/listings/[id]` with `comparables(property)`, status (sold price), "Create buyer report" → `access.createShareLink(ledger, 90 days, createdByOrgId)` → `updateListing({shareLinkId})` → URL `HOMEOWNER_APP_URL/r/<token>` shown once; "Ask the owner for full access first" when the grant is below full (RLS also refuses).

**Charts** (`src/components/charts.tsx`, per `docs/specs/charts.md`): stacked single bar for grade / risk bands, horizontal CSS bars for stage completion and policy status, stat tiles; grade tokens always with the letter; status colours reserved; `<details>` "Show the numbers" table under every chart. No chart library.

**Tests**: `tests/smoke.test.ts` (node:test + playwright-core, chromium with the brief's flags) — landing, wrong-password refusal, each of cal / bea / omar / ava opens the dashboard, the board and one property, the city records a review (verified, with a note, checked in history), the bank records a draw request and holds it with a note (checked on the draw page), the CSV export, and a lender bounced off a municipality page (307 → /dashboard, export 403).

## packages/* changes (all in packages/db, tests green)

1. `records.listStageGradesForProperties(tx, ids)` — **new**: stage grades for many houses in one query, so the board draws one comb per tile. (`stageCompletion` is an aggregate; nothing per-house existed.)
2. `access.listRequestsForOrgAsService(tx, orgId)` — **new, service-level, doc comment says why**: `listRequestsForOrg` inner-joins `properties`, so for an actor it drops exactly the rows a "your requests" page exists for (a pending request is on a house the requester cannot see yet). Returns the request plus the address only; the admin app confirms the actor's membership under RLS before calling it.
3. `oversight.recordInspectionReview` — **bug fix, same contract**: it did delete-then-insert, but `oversight.inspection_reviews` has UPDATE and INSERT policies and no DELETE policy, so for a real municipality member the delete matched nothing and the insert tripped `inspection_reviews_capture_muni_idx` on any re-review (the seed only worked because it runs as the service). It now updates the existing row in place, else inserts.

No other package was touched. No `npm install`; no new dependencies.

## Skipped / notes

- Policies, holdings and listings whose house the institution cannot see are not listed (the repo's `listPolicies` etc. inner-join `properties` under RLS). Seeded example: Ozark Mutual's quoted policy on 22 Cedar Ln does not appear until the owner approves the pending request. Left as RLS intends; the Requests page now shows the pending request itself.
- The property page's "Access" line names the grantor from `grants.grantedBy` → profile (readable because they own a house you can see); it falls back to "the owner".
- The draw-request form on `/draws` derives the house from the chosen holding (the action looks the holding up, no client state).
- Next dev reported one hydration note once (a hidden `<input>` in a withdraw form gained a `style="caret-color:transparent"` attribute client-side during an automated run); it did not reproduce and is not in the markup.
- The demo DB also carries rows written by the other two engineers' runs (e.g. a second framing capture on Ridgemont, a `done` capture without a grade) — the pages render them; nothing was reseeded.
- Draws created by the smoke test accumulate as `held` rows on the Ridgemont holding (one per run).

## Final commands (run in this order, dev server stopped for the first three)

```
apps/admin $ npx next typegen && npx tsc --noEmit   → ✓ Types generated successfully · tsc clean
apps/admin $ npm run lint                           → eslint: no findings (exit 0)
apps/admin $ npm run build                          → ✓ Compiled successfully · TypeScript finished · 4/4 static pages · exit 0
                                                      22 routes: / , /account, /audit, /dashboard, /draws, /draws/[id], /inspections, /inspections/[captureId],
                                                      /join/[token], /jurisdiction, /jurisdiction/export, /listings, /listings/[id], /onboard, /permits,
                                                      /policies, /portfolio, /properties, /properties/[slug], /requests, /team (+ /_not-found, /icon.png)
root $ npm run dev -w @homefax/admin (background) ; npm test -w @homefax/admin
                                                    → ℹ tests 10 · pass 10 · fail 0 (24.5 s); then kill $(lsof -ti :3002)
root $ npm test -w @homefax/db                      → ℹ tests 15 · pass 15 · fail 0 (after both repo changes)
```

Browser-checked with playwright-core / chromium at 1440×900 (every page as every demo account, light and dark) and 390×844 (landing, dashboard, jurisdiction board): no page errors, no console errors beyond three.js's `THREE.Clock` deprecation notice from the shared viewer.
