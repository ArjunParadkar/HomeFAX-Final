import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorLine, GradeChip } from "@homefax/ui";
import { toGrade } from "@homefax/core";
import { access, orgs, oversight, properties, records } from "@homefax/db";
import { createBuyerReportAction, revokeBuyerReportAction, updateListingStatusAction } from "@/app/(workspace)/listings/actions";
import { Comb, LISTING_TONE, RiskWord, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { cityOf, date, dateTime, money, n, score, streetOf, titleWord } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "active", "pending", "sold", "withdrawn"] as const;

/** One listing: the house's record, the buyer report, and the comparables the actor is allowed to see. */
export default async function ListingPage({ params, searchParams }: PageProps<"/listings/[id]">) {
  await requireKind("brokerage");
  const { id } = await params;
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token;

  const data = await asWorkspace(async (tx, ws) => {
    const listing = await oversight.getListing(tx, id);
    if (!listing || listing.orgId !== ws.org.id) return null;
    const home = await properties.getPropertyWithStats(tx, listing.propertyId);
    if (!home) return null;
    const reach = await access.reach(tx, home.property.id, { identityId: ws.me.identity.id });
    const grades = await records.listStageGrades(tx, home.property.id);
    const comps = await oversight.comparables(tx, home.property);
    const links = listing.shareLinkId ? (await access.listShareLinks(tx, home.property.id)).filter((l) => l.id === listing.shareLinkId) : [];
    const members = await orgs.listMembers(tx, ws.org.id);
    return { ws, listing, home, reach, grades, comps, link: links[0] ?? null, members };
  });
  if (!data) notFound();

  const { listing, home, grades, comps, link } = data;
  const scope = data.reach?.scope ?? null;
  const canIssue = access.scopeAtLeast(scope, "full");
  const live = link && !link.revokedAt && (!link.expiresAt || link.expiresAt > new Date());
  const homeownerApp = process.env.HOMEOWNER_APP_URL ?? "http://localhost:3001";
  const agent = listing.agentIdentityId ? data.members.find((m) => m.profile.identityId === listing.agentIdentityId)?.profile.name : null;
  const risk = oversight.riskProfile(home.stats);

  return (
    <>
      <PageTitle
        eyebrow={`Listing · ${titleWord(listing.status)}${listing.mlsRef ? ` · MLS ${listing.mlsRef}` : ""}`}
        title={streetOf(home.property)}
        subtitle={`${cityOf(home.property)} · ${money(listing.listPriceCents)}${agent ? ` · ${agent}` : ""} · listed ${date(listing.listedAt)}`}
        actions={
          <>
            {home.stats.meanScore != null && <GradeChip grade={toGrade(home.stats.meanScore)} />}
            <Link href={`/properties/${home.property.slug}`} className="btn btn-secondary btn-sm">
              Open the record
            </Link>
            <Link href="/listings" className="btn btn-secondary btn-sm">
              All listings
            </Link>
          </>
        }
      />
      <ErrorLine message={sp.error} className="mb-4" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Panel title="The house's record" meta={`${home.stats.stagesFilmed} / ${home.stats.stagesTotal} stages`}>
            <Comb grades={grades} />
            <dl className="rule-grid mt-4 grid-cols-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)] sm:grid-cols-4">
              <div className="field">
                <dt>Mean score</dt>
                <dd>{score(home.stats.meanScore)}</dd>
              </div>
              <div className="field">
                <dt>Points passed</dt>
                <dd>{home.stats.pointsAssessed ? `${home.stats.pointsPassed} / ${home.stats.pointsAssessed}` : "—"}</dd>
              </div>
              <div className="field">
                <dt>Verified by city</dt>
                <dd>{n(home.stats.verifiedStages)}</dd>
              </div>
              <div className="field">
                <dt>Open findings</dt>
                <dd>{n(home.stats.criticalFindings + home.stats.majorFindings)}</dd>
              </div>
            </dl>
            <p className="mt-3">
              <RiskWord band={risk.band} />
            </p>
          </Panel>

          <Panel title="Comparables" meta={`Same city · graded · ${comps.length} you can see`} flush>
            {comps.length === 0 ? (
              <Empty>No other graded house in {home.property.city} is in your view. Comparables only include houses you are allowed to see.</Empty>
            ) : (
              <div className="ledger-wrap">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Grade</th>
                      <th className="num">Mean</th>
                      <th className="num">Stages</th>
                      <th className="num">Points</th>
                      <th>Risk</th>
                      <th>Last filmed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c) => (
                      <tr key={c.property.id}>
                        <td>
                          <Link href={`/properties/${c.property.slug}`}>{streetOf(c.property)}</Link>
                        </td>
                        <td>{c.stats.meanScore != null ? <GradeChip grade={toGrade(c.stats.meanScore)} size="sm" /> : "—"}</td>
                        <td className="num">{score(c.stats.meanScore)}</td>
                        <td className="num">
                          {c.stats.stagesFilmed}/{c.stats.stagesTotal}
                        </td>
                        <td className="num">{c.stats.pointsAssessed ? `${c.stats.pointsPassed}/${c.stats.pointsAssessed}` : "—"}</td>
                        <td>
                          <RiskWord band={oversight.riskProfile(c.stats).band} />
                        </td>
                        <td className="mono">{date(c.stats.lastCaptureAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Buyer report" meta={live ? <StatusWord tone="good">Live</StatusWord> : link ? <StatusWord tone="warn">Expired or revoked</StatusWord> : undefined}>
            {token && (
              <div className="sheet mb-4 px-4 py-3">
                <p className="label">Buyer report link · shown once</p>
                <p className="tnum mt-1.5 break-all text-[0.8125rem]">
                  {homeownerApp}/r/{token}
                </p>
                <p className="mt-1.5 text-[0.75rem] text-[var(--ink-3)]">Copy it now. The token is not stored in clear; issue a new report if you lose it.</p>
              </div>
            )}
            {link ? (
              <dl className="rule-grid grid-cols-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)]">
                <div className="field">
                  <dt>Scope</dt>
                  <dd>{link.scope}</dd>
                </div>
                <div className="field">
                  <dt>Expires</dt>
                  <dd>{date(link.expiresAt)}</dd>
                </div>
                <div className="field">
                  <dt>Views</dt>
                  <dd>{n(link.viewCount)}</dd>
                </div>
                <div className="field">
                  <dt>Last viewed</dt>
                  <dd>{dateTime(link.lastViewedAt)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">No buyer report yet. One is a read-only link to this house at ledger scope — grades, the 50-point ledger, findings, and models — valid 90 days.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {canIssue ? (
                <form action={createBuyerReportAction}>
                  <input type="hidden" name="listingId" value={listing.id} />
                  <button type="submit" className="btn btn-primary btn-sm">
                    {link ? "Issue a fresh report" : "Create buyer report"}
                  </button>
                </form>
              ) : (
                <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                  <span className="font-medium text-[var(--ink)]">Ask the owner for full access first.</span> You see this house at {scope ?? "no"} scope; a buyer report needs the full record behind it.{" "}
                  <Link href="/properties" className="underline">
                    Request access
                  </Link>
                  .
                </p>
              )}
              {live && (
                <form action={revokeBuyerReportAction}>
                  <input type="hidden" name="listingId" value={listing.id} />
                  <input type="hidden" name="shareLinkId" value={link!.id} />
                  <button type="submit" className="btn btn-secondary btn-sm">
                    Revoke
                  </button>
                </form>
              )}
            </div>
          </Panel>

          <Panel title="Status">
            <p className="mb-3">
              <StatusWord tone={LISTING_TONE[listing.status]}>{titleWord(listing.status)}</StatusWord>
              {listing.soldPriceCents != null && <span className="tnum ml-2 text-[0.8125rem]">sold {money(listing.soldPriceCents)}</span>}
              {listing.closedAt && <span className="ml-2 text-[0.75rem] text-[var(--ink-3)]">closed {date(listing.closedAt)}</span>}
            </p>
            <form action={updateListingStatusAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <input type="hidden" name="listingId" value={listing.id} />
              <div>
                <label className="label block" htmlFor="status">
                  New status
                </label>
                <select id="status" name="status" defaultValue={listing.status} className="input input-sm select mt-1.5">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleWord(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="soldPrice">
                  Sold price <span className="normal-case tracking-normal">(if sold)</span>
                </label>
                <input id="soldPrice" name="soldPrice" inputMode="decimal" placeholder="$" className="input input-sm tnum mt-1.5" />
              </div>
              <button type="submit" className="btn btn-secondary btn-sm">
                Update
              </button>
            </form>
            {listing.notes && <p className="mt-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{listing.notes}</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
