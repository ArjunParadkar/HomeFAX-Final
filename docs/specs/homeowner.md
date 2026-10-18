# apps/homeowner — the house's own record, for the person who lives in it

Phone-first. Port 3001. `createAppKit("homeowner")` is in `src/lib/kit.ts`.

## Who uses it

A homeowner who was handed a claim code by their contractor, or who inherited
the record with the house. Also the buyer or inspector who opens a share link.
They are not builders: every number needs a sentence that says what it means
for the house.

## Design direction

Same system as the contractor app (paper register, onyx plates for the 3D
viewer), but the homeowner's copy is in the second person ("your framing was
measured plumb to 0.4°"). The signature element is the **house card**: the
address set large, the 11-tick comb underneath acting as the primary
navigation (each tick is a link to its stage; graded ticks carry the grade
colour; the open ticks are hollow), and one line beneath in mono that says
where the build stands ("7 of 11 stages on file · last filmed 12 Sep"). The
score is shown as a grade stamp, not a ring. One accent. No dashboards.

## Routes

- `/` — if signed in → `/home`. Else: the house card as a plate with the logo
  (`LogoMark variant="house" mode="once"`), then Sign in / Create account tabs
  (same two-link convention as the contractor landing), then a third way in:
  "Have a claim code?" → `/claim`.
- `/claim` — enter `XXXX-XXXX` (auto-format, accept lowercase). If not signed
  in, the form collects name/email/password too and signs them up first
  (`auth.signUp` then `properties.claimProperty`, both service). Success → the
  new house. Errors: expired / invalid code, in the record's voice.
- `/home` — "Your homes": one house card per property from
  `properties.listPropertiesForOwner`; pending access requests across all
  houses as a banner ("First Ozark Bank is asking to see 1418 Ridgemont Dr").
  Most people have one house — when exactly one, redirect to it.
- `/home/[slug]` — the house. House card; a grade stamp for the latest graded
  stage with a one-sentence reading; the stats row as `.field`s (points
  passed, open safety items, materials on record $); the timeline
  (`properties.listEvents`, 10 most recent, "Show everything"); the sequence of
  11 stages as a rail (as in the contractor record page) each linking to its
  stage page; links to Materials, Access, Documents, History.
- `/home/[slug]/stages/[stage]` — the model (`@homefax/ui/model-viewer`
  dynamic import; the seed uses `procedural://framed-room`, which the viewer
  already renders as a stand-in — label it "Simulated geometry" exactly as the
  contractor app does), the grade stamp, `QualityPanel` (the 50-point ledger
  with evidence), frames (`capture.frames` → `<img>` grid; seed frames live at
  `/demo/kf0N.png`), the municipality's verdict if any
  (`oversight.listReviewsForProperty`), and "What was put in" — the stage's
  materials (`PartsTable`, no prices for a homeowner? **Show prices**: it is
  their house; the full scope includes cost).
- `/home/[slug]/materials` — every material line across stages
  (`records.listPartLines` grouped by category), the exact identifications
  called out ("Kohler K-2362 — read off the nameplate in frame 4"), and a
  mono total. Copy: "What is in your walls".
- `/home/[slug]/access` — **the owner's control panel**: current grants
  (org name, scope, purpose, since, Revoke), pending requests (Approve at
  the requested scope / Approve summary only / Deny — `access.decideRequest`),
  share links (create: label + scope + expiry 7/30/90 days/never →
  `access.createShareLink`, show the URL once `<origin>/r/<token>`; list with
  view counts; Revoke), and the access log ("First Ozark Bank looked at the
  ledger · 4 times · last Tue"). Explain the three scopes in one line each
  (`access.SCOPE_BLURB`). Also "Municipality": if a municipality's jurisdiction
  covers the house, say so and that this is statutory (`orgs` helper
  `municipalitiesCovering` — add it to `packages/db/src/repos/orgs.ts` if the
  contractor agent has not; coordinate by checking the file first).
- `/home/[slug]/documents` — list + upload (Blob client upload exactly like the
  contractor's `/api/blob/upload`, 25 MB, pdf/jpg/png; `properties.addDocument`),
  kind select, delete own uploads.
- `/home/[slug]/history` — the full timeline, and who owned it when
  (`properties.listOwners(…, true)`).
- `/r/[token]` — **public report**, no sign-in. `access.resolveShareLink`
  (service) → render with `kit.asVisitor(fn, hashToken(token))` so RLS scopes
  the data to the link. Summary: address, stats, grades per stage. Ledger: +
  models and ledger per stage (read-only, same components). Full: + materials.
  A clear banner: "Shared by the owner · ledger access · expires 12 Nov".
  `viewProperty` logs it with `via: share_link`.
- `/account` — name, handle, phone (stored encrypted; show masked), password
  change, sessions list with revoke, sign out, "Delete my account"
  (`auth.eraseIdentity` after password confirm; ownership rows stay as history).

## Done means

Build, lint, tsc clean; `tests/smoke.test.ts` signs in as `rupali@demo.homefax`,
lands on her houses, opens 1418 Ridgemont Dr, opens the framing stage, approves
or sees the lender's grant on `/access`, creates a share link, opens it signed
out, and sees the summary. Also signs up a fresh account through `/claim` with a
code printed by `npm run db:seed` (re-running the seed is idempotent; the codes
in the seed output are for the unclaimed houses — note the printed code before
you start, or read `property.owner_invites` is hashed so you must use a printed
one; if none is left, create one as `arjun@demo.homefax` from the contractor
app's record page once that agent is done, or add a tiny
`packages/db/scripts/issue-claim-code.ts`). Write `docs/specs/homeowner.DONE.md`.
