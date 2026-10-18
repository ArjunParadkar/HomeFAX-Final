# apps/admin — HomeFAX for institutions

Desktop-first (works at 1024+, degrades to a single column on a phone). Port
3002. `createAppKit("admin")` is in `src/lib/kit.ts`. One app, four
workspaces chosen by the organisation's `kind`: **municipality**, **lender**,
**insurer**, **brokerage**. A person can belong to several orgs; an org
switcher sits in the rail.

## Design direction

The ledger room. Same tokens and type as the other apps, but laid out for a
desk: a fixed left rail (wordmark, org switcher, sections, the person), a wide
content column with a page title row, and dense tables with mono figures. The
record stays paper; instruments (model viewer, the key panel) stay onyx. The
signature element is the **board**: a grid of house tiles, each a miniature of
the homeowner's house card — address, the 11-tick comb with grade colours, the
grade chip, two mono figures — filterable by grade / stage / status, and the
same tile is used for a portfolio, a jurisdiction, a book of policies, or a set
of listings. Charts follow `docs/specs/charts.md`.

## Shared routes (every kind)

- `/` — sign in / create account (two-link tabs). After sign-in: no org →
  `/onboard`; else `/dashboard`.
- `/onboard` — "Register your institution": name, kind (four cards with one
  line each on what the workspace does), headline. Municipalities add their
  first jurisdiction here (state + city / county / ZIP). `orgs.createOrg`,
  `orgs.addJurisdiction`.
- `/dashboard` — the kind-specific overview (below).
- `/properties` — the board of every property the org can reach
  (`oversight.listReachableProperties` — RLS-filtered) + search box
  (`properties.searchProperties`). Houses the org *cannot* see do not appear;
  instead a "Request access to a property" form takes an address
  (`parseAddressLine`), looks it up as the service (`findOrCreateProperty` with
  `createdBy` null is **not** acceptable here — add a repo
  `properties.findByAddress(tx, parts)` that only reads, and run it as service),
  and files `access.requestAccess` (service, after checking the actor is a
  member of the org) with scope + purpose. Pending requests listed on
  `/requests`.
- `/properties/[slug]` — the property, at the org's scope: `viewProperty` first
  (404 when null). Header with address, stats `.field`s, the comb, risk
  profile (`oversight.riskProfile(stats)`: band + the reasons as a list),
  stages table (stage · grade · score · filmed · municipality verdict), and
  tabs by scope: Ledger (checkpoints by category, `QualityPanel` per stage),
  Findings (open, by severity), Models (viewer), Materials (full scope only),
  Permits, Draws/Policies/Listing panels relevant to the org's kind, Timeline
  (`listEvents` — RLS hides what the scope does not allow), and an "Access"
  line: "You see this house via grant (ledger) · granted 3 Oct by the owner".
- `/requests` — the org's access requests and their status; withdraw.
- `/team` — members, roles, invite by link (`orgs.createInvitation`, show the
  URL once: `<origin>/join/<token>`), remove, transfer ownership; the org's
  profile (name, headline, public listing); for municipalities, jurisdictions
  CRUD.
- `/join/[token]` — accept an invitation (sign in or create account first).
- `/audit` — `audit.listAuditForOrg` rendered with `describeAudit`, plus the
  org's own access log (`access.listAccessLogForOrg`): every look its members
  took at a house. Institutions are accountable too.
- `/account` — profile, password, sessions, sign out.

## Municipality workspace

- Dashboard: tiles — properties in jurisdiction, stages filmed this quarter,
  awaiting review, flagged; a grade-distribution bar (`gradeHistogram`); the
  **inspection queue** (`oversight.listInspectionQueue`): stage, address,
  grade, filmed date, "Review" → a review drawer/page per capture
  (`/inspections/[captureId]`): the model, ledger, findings, and three verdict
  buttons — Verified / Flagged / Site visit — with a note
  (`oversight.recordInspectionReview`). Optional permit link (select from the
  org's permits on that property).
- `/jurisdiction` — the board of `listJurisdictionProperties`, filters, CSV
  export (a route handler streaming `text/csv`).
- `/permits` — list + create (`createPermit`) + status changes (`updatePermit`).
  Linking a permit to a build record: select from `records.listRecordsForProperty`.
- `/inspections` — the queue with "include reviewed" toggle, and history.

## Lender workspace

- Dashboard: tiles — holdings, principal outstanding (sum, mono, `$`), draws
  awaiting decision, houses at elevated/high risk; a risk-band bar; the
  **draw queue**: stage, address, amount, the recommendation line
  (`recommendDraw` is already stored on the draw as `recommendation`; show
  it and also recompute live), Release / Hold / Reject with a note
  (`decideDraw`).
- `/portfolio` — the board of holdings (`listHoldings`): address, kind,
  principal, rate, latest grade, risk band, open draws. Add holding (property
  picker from reachable properties; loan reference stored encrypted and shown
  masked `••••0418` via `oversight.dec`), edit status.
- `/draws` — all draws with filters; a draw detail shows `recommendDraw`'s
  reasons and the basis capture's grade stamp.

## Insurer workspace

- Dashboard: tiles — policies by status, coverage in force, houses with open
  moisture or safety items, renewals in 60 days; the **underwriting board**:
  each policy's house with `categoryBreakdown` rendered as a 7-row mini table
  (structure / envelope / moisture / mechanical / surfaces / safety / capture ×
  pass / attention / fail) and the risk band.
- `/policies` — list (`listPolicies`), create (kind, reference encrypted,
  coverage, premium, dates, status), update status.
- Property page gains an "Underwriting" tab with the breakdown and open
  findings.

## Brokerage workspace

- Dashboard: tiles — active listings, under contract, sold, median list price;
  the **listing board** with the grade and "Buyer report" link status.
- `/listings` — list (`listListings`), create (property picker, price, MLS ref,
  agent = a member), status changes; per listing: "Create buyer report" →
  `access.createShareLink(scope ledger, 90 days, createdByOrgId)` → store id on
  the listing (`updateListing shareLinkId`), show the URL
  (`HOMEOWNER_APP_URL/r/<token>`, env default http://localhost:3001). The
  brokerage needs **full** scope from the owner to create a share link (RLS
  enforces it); otherwise show "Ask the owner for full access first" with the
  request form.
- `/listings/[id]` — the listing with `comparables(property)` (same city,
  graded houses the actor can see) as a small table.

## Done means

Build, lint, tsc clean; `tests/smoke.test.ts` signs in as each of
`cal@demo.homefax` (City of Bentonville), `bea@demo.homefax` (First Ozark
Bank), `omar@demo.homefax` (Ozark Mutual), `ava@demo.homefax` (Ridgeline
Realty), opens the dashboard, the board, and one property; the city records a
review; the bank decides a draw. Write `docs/specs/admin.DONE.md`.
