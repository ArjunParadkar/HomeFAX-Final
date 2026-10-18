# apps/homeowner — DONE (2026-10-17)

Built from the scaffold per `docs/specs/homeowner.md`. Port 3001, `createAppKit("homeowner")`,
every read under RLS via `kit.asMe` / `kit.asVisitor`, server components + server actions
(`FormData` → repo → `revalidatePath` → `redirect`, failures via `fail(path, errorMessage(e))`
and `<ErrorLine>`), phone-first at 390px, dark mode through the tokens only.

## What was built

**Routes** (all `force-dynamic`):

| Route | What it does |
|---|---|
| `/` | Signed in → `/home`. Else the onyx plate with `LogoMark variant="house" mode="once"`, the wordmark, and an *empty house card* (every tick hollow) as the signature; Sign in / Create account as two links (`?mode=`); "Have a claim code?" → `/claim`. |
| `/claim` | `XXXX-XXXX` input that upper-cases and inserts the dash as you type (`ClaimCodeInput`, accepts lowercase/no dash). Signed out it also collects name/email/password; `auth.signUp` + `properties.claimProperty` run in **one service transaction**, so a bad code never leaves a half-made account. Success → `/home/<slug>?claimed=1`. Errors in the record's voice. |
| `/home` | "Your homes": one `HouseCard` per `properties.listPropertiesForOwner` row, pending requests across all houses as an accent banner ("Ozark Mutual is asking to see 22 Cedar Ln"), empty state → claim. **Exactly one house → redirect to it.** |
| `/home/[slug]` | The house. `HouseCard` (address large, 11-tick comb where each tick links to its stage, graded ticks in the grade colour, filmed-ungraded in accent, in-flight pulsing, open hollow; mono standing line "7 of 11 stages on file · last filmed 12 Sep"), a `GradeStamp` for the latest graded stage with a second-person reading ("Your HVAC rough-in scored 87 of 100 and is sound, with minor notes — 12 of 14 assessed points passed."), the stats row as `.field`s (points passed / open safety / materials $) with a sentence saying what the numbers mean, links to Materials/Access/Documents/History, the 10 most recent events with "Show everything", and the 11-stage rail (`StageRail`). Pending requests on this house are a banner to `/access`. |
| `/home/[slug]/stages/[stage]` | `@homefax/ui/model-viewer` (dynamic import) on the plate with the exact "Simulated geometry" note for `procedural://framed-room`; "What this means for your house" sentence; the city's verdict (`oversight.listReviewsForProperty`, filtered to this capture); `QualityPanel` (stamp + 50-point ledger + rubric + findings); frames grid from `capture.frames` (`<img>`, `/demo/kf0N.png` in the seed); `PartsTable` "What was put in" **with prices** (it is their house). Not-filmed / being-built / failed states with the stage checklist. Prev/next stage buttons. Shared body is `components/StageView.tsx` (reused by the public report). |
| `/home/[slug]/materials` | "What is in your walls": lines/stages/total as fields, "Read off a label" list of exact identifications ("Kohler K-2362 … read off the nameplate in frame 4"), then `PartsTable` grouped by category with the mono subtotal. `records.listPartLines` rows mapped back to `PartLine` (`lib/house.ts:toPartLines`). |
| `/home/[slug]/access` | The owner's control panel: live grants (org name, scope, purpose, since/until, **Revoke**), pending requests (**Approve at requested scope / Summary only / Deny** via `access.decideRequest`), share links (create with label + scope + 7/30/90/never → `access.createShareLink`; the URL `<origin>/r/<token>` is shown **once** via a 15-minute httpOnly cookie scoped to the page, dismissed with a button — never in a query string; list with view counts + last viewed; Revoke), the three scopes explained with `access.SCOPE_BLURB`, the municipality's statutory view via `orgs.municipalitiesCovering` (already existed), and the access log folded into "First Ozark Bank looked at the ledger with your permission · 4 times · last today" (share-link looks read "Someone with the “label” link"). |
| `/home/[slug]/documents` | List (title → blob URL, kind chip, size, date, "from the builder"), **Remove** (`properties.removeDocument`; RLS lets the owner remove any), and upload: `DocumentUpload` client component does the Blob client upload (`@vercel/blob/client` `upload` → `/api/blob/upload`, pdf/jpg/png, 25 MB) and then posts the URL to `addDocumentAction` (`properties.addDocument`). When `BLOB_READ_WRITE_TOKEN` is absent (it is, locally) the panel says so plainly instead of pretending. |
| `/home/[slug]/history` | Owners over time (`properties.listOwners(…, true)`, with "(you)" and Past chips) and the full timeline (`Timeline`, 500 events). |
| `/r/[token]` | **Public report**, no sign-in. `access.resolveShareLink` as the service (counts the view), then everything under `kit.asVisitor(fn, hashToken(token))` so RLS scopes the data. Banner "Shared by the owner · ledger access · expires 12 Nov". Summary: house card, stats, grade per stage. Ledger: + the selected stage's model, ledger, frames, city verdict. Full: + materials per stage and the whole-house `PartsTable`. The comb ticks and the grade list select a stage (`?stage=`) so the page never mounts eleven WebGL canvases. Dead/expired/revoked tokens render "This link no longer opens". |
| `/account` | Name, handle, phone (stored encrypted via `people.updateProfile({ phone })`, shown masked `••• ••• 0100`), password change (`auth.changePassword`, service), sessions list with device/IP/last seen, per-session Revoke + "Sign out every other device", Sign out, and "Delete my account" behind a `<details>` with password confirm → `auth.eraseIdentity` (ownership rows stay as history; landing shows the erased notice). |
| `/api/blob/upload` | Mints the scoped client-upload token for a signed-in homeowner (same shape as the contractor route). |
| `not-found.tsx` | "There is nothing here for you" — a house you do not own and a page that does not exist look the same on purpose. |

**Components** (`src/components`): `AppHeader` (shared header with the two homeowner tabs: Your homes / Account), `HouseCard` (the signature; paper or plate surface; address can be its own link while ticks are theirs — no nested anchors; tick links are 44px tall tap targets with `aria-label` "03 Framing — graded B"), `StageRail`, `Timeline`, `StageView`, `ClaimCodeInput` (client), `DocumentUpload` (client).

**Lib** (`src/lib`): `kit.ts` (scaffold), `house.ts` (`openHouse` = slug → `viewProperty` → 404 on null; `ticksForOwner` / `ticksFromGrades`; `standingLine`; `toPartLines`), `format.ts` (dates "12 Sep", "last Tue", money, `gradeReading`), `storage.ts` (Blob flag, document kinds), `share.ts` (the show-once cookie).

**Actions**: `app/account/actions.ts` (sign in/up/out, profile, password, sessions, erase), `app/claim/actions.ts` (claim), `app/home/[slug]/actions.ts` (revoke grant, decide request, create/dismiss/revoke share link, add/remove document).

`withService` is used only for: `auth.signIn`, `auth.signUp`, `properties.claimProperty`, `access.resolveShareLink`, `auth.changePassword`, `auth.checkPassword` + `auth.eraseIdentity` — the last three because the auth repo's doc comment says every credential-touching function needs a service transaction. Sessions are listed/revoked as the actor (RLS `sessions_self`).

## packages/* changes (additive)

- `packages/db/src/repos/auth.ts`: added `checkPassword(tx, identityId, password)` — a service-level "does this password belong to this identity" used to confirm the person before erasing the account (doc comment says why). `npm test -w @homefax/db`: 14/14 pass.
- Nothing else. `orgs.municipalitiesCovering`, `properties.findByAddress` and `issue-claim-code.ts` already existed and were used as-is.

## Findings worth knowing

- **`access.reach()` cannot see share links for an anonymous visitor.** `access.share_links` SELECT policy only admits the service, the owner, the creator and the creator's org, so `reach()` (and therefore `viewProperty`) returns `null` for a visitor whose only path is the token — while `app.property_scope()` (SECURITY DEFINER) correctly returns the link's scope and RLS scopes the rows fine. `/r/[token]` therefore calls `viewProperty` first (owners/grantees get logged by their own path) and, when it returns null, writes the look itself with `access.logAccess({ via: "share_link", shareLinkId })` (insert policy is open). Verified in the smoke test: the visitor's look appears on the owner's log. A one-line fallback in `reach()` to `scopeOf()` would let `viewProperty` cover this case; I did not change shared code the other engineers may be editing.
- With `loading.tsx` present, the streamed shell has already gone out when `notFound()` fires, so the HTTP status is 200 while the not-found page renders. The smoke test asserts on the rendered page.
- The seeded DB is shared and live: during this session 1418 Ridgemont Dr gained a re-filmed framing capture (from the contractor app), so its stats read "8 of 11 stages on file" with 7 graded ticks. The app renders whatever the record holds.
- One hydration warning was seen once in headless dev on `/claim` (an injected `caret-color: transparent` style on inputs, not from app code); it did not recur across later runs.

## Skipped / not done, and why

- **Document upload could not be exercised end-to-end**: no `BLOB_READ_WRITE_TOKEN` locally. The route and client upload mirror the contractor's working path; the page shows a plain "storage is not configured" notice instead of a broken form.
- **Deciding the seeded access request on 22 Cedar Ln** is deliberately not done by the test (the admin/insurer demo depends on it staying pending); the test asserts the Approve / Summary only / Deny controls are there for Dana.
- Approve/Deny and Revoke-grant were verified by code path and RLS tests, not by the smoke test, for the same reason (they would alter the shared demo state).
- No `npm install`: no new dependencies.
- The brief's `kill $(lsof -ti :3001)` was used to stop the dev server; nothing was committed.

## Final commands (run from `apps/homeowner` unless noted) and results

```
npx next typegen && npx tsc --noEmit        → exit 0 (route types generated, no type errors)
npm run lint                                → exit 0 (0 problems)
npm run build                               → exit 0 (Compiled successfully; 13 routes, / … /r/[token] dynamic)
npm test -w @homefax/homeowner  (repo root) → 15 tests, 15 pass, 0 fail (against `npm run dev -w @homefax/homeowner` on :3001)
npm test -w @homefax/db         (repo root) → 14 tests, 14 pass, 0 fail
```

`tests/smoke.test.ts` (node:test + playwright-core, `/usr/bin/chromium` with the brief's flags, 390×844): landing tabs; wrong password error; Rupali signs in → `/home` lists both houses with 11-link combs; opens 1418 Ridgemont Dr (card, stamp, stats, timeline, rail); a comb tick opens the framing stage (simulated-model note, 50-point ledger, frames, materials); materials total; `/access` shows First Ozark Bank's grant + the City of Bentonville's statutory view; creates a 7-day summary share link, sees the URL once; opens it in a fresh context signed out → summary only (no rubric, no model); the visitor's look appears on the owner's log; revoking the link makes it die; Dana's house 404s for Rupali; Dana is redirected to her single house with Ozark Mutual's request waiting and the three decision buttons; account page; a bad claim code is refused; a fresh account signs up through `/claim` with a code minted by `packages/db/scripts/issue-claim-code.ts 1200-nw-3rd-st-bentonville` (typed lowercase without the dash), lands on the house, and the spent code is refused.

The unused seeded code `6HVB-CCSC` for 1200 NW 3rd St was left untouched; each test run mints and spends its own and creates one `smoke-<ts>@demo.homefax` owner of 1200 NW 3rd St.
