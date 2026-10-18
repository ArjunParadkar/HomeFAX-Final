import Link from "next/link";
import { ErrorLine, GradeChip } from "@homefax/ui";
import { stageDef } from "@homefax/core";
import { access, oversight, type PropertyStats } from "@homefax/db";
import { decideDrawAction } from "@/app/(workspace)/portfolio/actions";
import { Board, type BoardRow } from "@/components/Board";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { GradeBar, HBars, RiskBar, Tiles } from "@/components/charts";
import { RiskWord, StatusWord } from "@/components/bits";
import { filmedThisQuarter, gradesFor, pointsFigure, riskCounts } from "@/lib/board";
import { date, daysUntil, money, plural, score, streetOf } from "@/lib/format";
import { asWorkspace, KIND_LABEL } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** The kind-specific overview. Tiles, one chart, and the queue the desk works from. */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const data = await asWorkspace(async (tx, ws) => {
    const org = ws.org;
    switch (org.kind) {
      case "municipality": {
        const jur = await oversight.listJurisdictionProperties(tx, org.id);
        const grades = await gradesFor(tx, jur);
        const queue = await oversight.listInspectionQueue(tx, org.id);
        const completion = await oversight.stageCompletion(tx, jur.map((r) => r.property.id));
        return { kind: "municipality" as const, org, jur, grades, queue, completion };
      }
      case "lender": {
        const holdings = await oversight.listHoldings(tx, org.id);
        const draws = await oversight.listDrawsForOrg(tx, org.id, ["requested"]);
        const live = new Map<string, oversight.DrawRecommendation>();
        for (const d of draws) live.set(d.draw.id, await oversight.recommendDraw(tx, d.property.id, d.draw.stage));
        const completion = await oversight.stageCompletion(tx, [...new Set(holdings.map((h) => h.property.id))]);
        return { kind: "lender" as const, org, holdings, draws, live, completion };
      }
      case "insurer": {
        const policies = await oversight.listPolicies(tx, org.id);
        const grades = await gradesFor(tx, policies);
        const breakdowns = new Map<string, oversight.CategoryBreakdown[]>();
        for (const p of policies) if (!breakdowns.has(p.property.id)) breakdowns.set(p.property.id, await oversight.categoryBreakdown(tx, p.property.id));
        return { kind: "insurer" as const, org, policies, grades, breakdowns };
      }
      case "brokerage": {
        const listings = await oversight.listListings(tx, org.id);
        const grades = await gradesFor(tx, listings);
        const links = new Map<string, boolean>();
        for (const l of listings) {
          if (!l.row.shareLinkId) continue;
          const all = await access.listShareLinks(tx, l.property.id);
          const link = all.find((x) => x.id === l.row.shareLinkId);
          links.set(l.row.id, Boolean(link && !link.revokedAt && (!link.expiresAt || link.expiresAt > new Date())));
        }
        return { kind: "brokerage" as const, org, listings, grades, links };
      }
    }
  });

  const subtitle = `${KIND_LABEL[data.org.kind]} workspace · ${data.org.headline ?? "HomeFAX for institutions"}`;

  if (data.kind === "municipality") {
    const stats = data.jur.map((r) => r.stats);
    const flagged = stats.reduce((s, x) => s + x.flaggedStages, 0);
    return (
      <>
        <PageTitle eyebrow="Dashboard" title={data.org.name} subtitle={subtitle} actions={<Link href="/jurisdiction" className="btn btn-secondary btn-sm">Open the jurisdiction board</Link>} />
        <ErrorLine message={sp.error} className="mb-4" />
        <Tiles
          items={[
            { term: "Properties in jurisdiction", value: String(data.jur.length) },
            { term: "Stages filmed this quarter", value: String(filmedThisQuarter(data.grades.values())) },
            { term: "Awaiting review", value: String(data.queue.length) },
            { term: "Stages flagged", value: String(flagged) },
          ]}
        />
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-5">
            <Panel title="Houses by grade" meta={`${stats.filter((s) => s.meanScore != null).length} graded`}>
              <GradeBar hist={oversight.gradeHistogram(stats)} />
            </Panel>
            <Panel title="Stages on file" meta={`of ${data.jur.length} houses`}>
              <HBars caption="Houses with each stage on file" max={Math.max(1, data.jur.length)} rows={data.completion.map((c) => ({ key: c.stage, label: c.label, value: c.filmed, display: c.meanScore != null ? `${c.filmed} · mean ${Math.round(c.meanScore)}` : String(c.filmed) }))} />
            </Panel>
          </div>
          <Panel title="Inspection queue" meta={<Link href="/inspections" className="underline">All inspections</Link>} flush>
            {data.queue.length === 0 ? (
              <Empty>Nothing is waiting. Every filmed stage inside your jurisdiction has a verdict.</Empty>
            ) : (
              <div className="ledger-wrap">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Address</th>
                      <th>Grade</th>
                      <th className="num">Score</th>
                      <th>Filmed</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.queue.slice(0, 12).map((q) => (
                      <tr key={q.capture.id}>
                        <td className="font-medium">{stageDef(q.capture.stage).label}</td>
                        <td>
                          <Link href={`/properties/${q.property.slug}`}>{streetOf(q.property)}</Link>
                        </td>
                        <td>{q.grade ? <GradeChip grade={q.grade.grade} size="sm" /> : "—"}</td>
                        <td className="num">{score(q.grade?.score)}</td>
                        <td className="mono">{date(q.grade?.filmedAt ?? q.capture.createdAt)}</td>
                        <td className="num">
                          <Link href={`/inspections/${q.capture.id}`} className="btn btn-primary btn-sm">
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </>
    );
  }

  if (data.kind === "lender") {
    const active = data.holdings.filter((h) => h.row.status === "active" || h.row.status === "default");
    const principal = active.reduce((s, h) => s + h.row.principalCents, 0);
    const stats = data.holdings.map((h) => h.stats);
    const risky = stats.filter((s) => ["elevated", "high"].includes(oversight.riskProfile(s).band)).length;
    return (
      <>
        <PageTitle eyebrow="Dashboard" title={data.org.name} subtitle={subtitle} actions={<Link href="/portfolio" className="btn btn-secondary btn-sm">Open the portfolio</Link>} />
        <ErrorLine message={sp.error} className="mb-4" />
        <Tiles
          items={[
            { term: "Holdings", value: String(data.holdings.length), note: `${active.length} active` },
            { term: "Principal outstanding", value: money(principal) },
            { term: "Draws awaiting decision", value: String(data.draws.length) },
            { term: "Houses at elevated or high risk", value: String(risky) },
          ]}
        />
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-5">
            <Panel title="Houses by risk band" meta={plural(stats.length, "house")}>
              <RiskBar counts={riskCounts(stats)} />
            </Panel>
            <Panel title="Stages on file" meta={`of ${new Set(data.holdings.map((h) => h.property.id)).size} houses`}>
              <HBars caption="Houses in the portfolio with each stage on file" max={Math.max(1, new Set(data.holdings.map((h) => h.property.id)).size)} rows={data.completion.map((c) => ({ key: c.stage, label: c.label, value: c.filmed, display: c.meanScore != null ? `${c.filmed} · mean ${Math.round(c.meanScore)}` : String(c.filmed) }))} />
            </Panel>
          </div>
          <Panel title="Draw queue" meta={<Link href="/draws" className="underline">All draws</Link>} flush>
            {data.draws.length === 0 ? (
              <Empty>No draw is waiting on a decision. New requests from the builder appear here with the record&apos;s recommendation.</Empty>
            ) : (
              <ul>
                {data.draws.map((d) => {
                  const live = data.live.get(d.draw.id)!;
                  return (
                    <li key={d.draw.id} className="border-b border-[var(--line)] px-4 py-4 last:border-b-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[0.9375rem] font-semibold leading-snug">
                            {stageDef(d.draw.stage).label} · <span className="tnum">{money(d.draw.amountCents)}</span>
                          </p>
                          <p className="mt-0.5 text-[0.8125rem] text-[var(--ink-2)]">
                            <Link href={`/properties/${d.property.slug}`} className="underline decoration-[var(--line)] underline-offset-2">
                              {streetOf(d.property)}
                            </Link>{" "}
                            · requested {date(d.draw.requestedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {live.grade && <GradeChip grade={live.grade} size="sm" />}
                          <StatusWord tone={live.recommendation === "release" ? "good" : "warn"}>{live.recommendation === "release" ? "Record says release" : "Record says hold"}</StatusWord>
                        </div>
                      </div>
                      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                        {live.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      {d.draw.recommendation && d.draw.recommendation.split(":")[0] !== live.recommendation && (
                        <p className="mt-1.5 text-[0.75rem] text-[var(--ink-3)]">At request time the record said: {d.draw.recommendation}</p>
                      )}
                      <form action={decideDrawAction} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="drawId" value={d.draw.id} />
                        <input type="hidden" name="back" value="/dashboard" />
                        <div className="min-w-[14rem] flex-1">
                          <label className="label block" htmlFor={`note-${d.draw.id}`}>
                            Note <span className="normal-case tracking-normal">(optional)</span>
                          </label>
                          <input id={`note-${d.draw.id}`} name="note" placeholder="Why, in a line" className="input input-sm mt-1" />
                        </div>
                        <button type="submit" name="status" value="released" className="btn btn-primary btn-sm">
                          Release
                        </button>
                        <button type="submit" name="status" value="held" className="btn btn-secondary btn-sm">
                          Hold
                        </button>
                        <button type="submit" name="status" value="rejected" className="btn btn-secondary btn-sm">
                          Reject
                        </button>
                        <Link href={`/draws/${d.draw.id}`} className="btn btn-sm text-[var(--ink-2)]">
                          Detail
                        </Link>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </>
    );
  }

  if (data.kind === "insurer") {
    const byStatus = new Map<string, number>();
    for (const p of data.policies) byStatus.set(p.row.status, (byStatus.get(p.row.status) ?? 0) + 1);
    const inForce = data.policies.filter((p) => p.row.status === "bound" || p.row.status === "active");
    const coverage = inForce.reduce((s, p) => s + p.row.coverageCents, 0);
    const houses = new Map<string, PropertyStats>(data.policies.map((p) => [p.property.id, p.stats]));
    const wet = [...houses.values()].filter((s) => s.openMoistureItems > 0 || s.openSafetyItems > 0).length;
    const renewals = data.policies.filter((p) => {
      const d = daysUntil(p.row.effectiveTo);
      return d != null && d >= 0 && d <= 60 && (p.row.status === "bound" || p.row.status === "active");
    }).length;
    const order = ["quoted", "bound", "active", "lapsed", "cancelled"];
    return (
      <>
        <PageTitle eyebrow="Dashboard" title={data.org.name} subtitle={subtitle} actions={<Link href="/policies" className="btn btn-secondary btn-sm">Open the book of policies</Link>} />
        <ErrorLine message={sp.error} className="mb-4" />
        <Tiles
          items={[
            { term: "Policies", value: String(data.policies.length), note: order.filter((s) => byStatus.get(s)).map((s) => `${byStatus.get(s)} ${s}`).join(" · ") || undefined },
            { term: "Coverage in force", value: money(coverage) },
            { term: "Houses with open moisture or safety items", value: String(wet) },
            { term: "Renewals in 60 days", value: String(renewals) },
          ]}
        />
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Panel title="Policies by status" meta={plural(data.policies.length, "policy", "policies")}>
            <HBars caption="Policies by status" rows={order.map((s) => ({ key: s, label: s.replace(/^\w/, (c) => c.toUpperCase()), value: byStatus.get(s) ?? 0 }))} />
          </Panel>
          <Panel title="Underwriting board" meta="Pass · attention · fail per ledger category" flush>
            {data.policies.length === 0 ? (
              <Empty>No policies yet. Create one from the Policies page and its house appears here with the ledger breakdown.</Empty>
            ) : (
              <ul className="grid md:grid-cols-2">
                {data.policies.map((p) => {
                  const risk = oversight.riskProfile(p.stats);
                  const rows = data.breakdowns.get(p.property.id) ?? [];
                  return (
                    <li key={p.row.id} className="border-b border-[var(--line)] px-4 py-4 md:odd:border-r md:[&:nth-last-child(-n+2)]:border-b-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/properties/${p.property.slug}?tab=underwriting`} className="block truncate text-[0.9375rem] font-semibold leading-snug">
                            {streetOf(p.property)}
                          </Link>
                          <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
                            {p.row.kind.replace("_", " ")} · {p.row.status} · {money(p.row.coverageCents, { compact: true })}
                          </p>
                        </div>
                        <RiskWord band={risk.band} />
                      </div>
                      <table className="ledger mt-3">
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th className="num">Pass</th>
                            <th className="num">Attn</th>
                            <th className="num">Fail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.category}>
                              <td className="capitalize">{r.category}</td>
                              <td className="num" style={{ color: "var(--grade-a)" }}>
                                {r.pass}
                              </td>
                              <td className="num" style={{ color: r.attention ? "var(--grade-c)" : undefined }}>
                                {r.attention}
                              </td>
                              <td className="num" style={{ color: r.fail ? "var(--grade-f)" : undefined }}>
                                {r.fail}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </>
    );
  }

  // brokerage
  const count = (s: string) => data.listings.filter((l) => l.row.status === s).length;
  const prices = data.listings.map((l) => l.row.listPriceCents).filter((p): p is number => p != null).sort((a, b) => a - b);
  const median = prices.length ? (prices.length % 2 ? prices[(prices.length - 1) / 2] : Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)) : null;
  const rows: BoardRow[] = data.listings.map((l) => {
    const has = data.links.get(l.row.id);
    return {
      property: l.property,
      stats: l.stats,
      grades: data.grades.get(l.property.id) ?? [],
      figures: [
        { term: "List price", value: money(l.row.listPriceCents) },
        { term: "Points", value: pointsFigure(l.stats) },
      ],
      status: has === true ? { label: "Buyer report live", tone: "good" } : has === false ? { label: "Buyer report expired", tone: "warn" } : { label: `${l.row.status} · no buyer report`, tone: "neutral" },
      href: `/listings/${l.row.id}`,
    };
  });
  return (
    <>
      <PageTitle eyebrow="Dashboard" title={data.org.name} subtitle={subtitle} actions={<Link href="/listings" className="btn btn-secondary btn-sm">Open the listings</Link>} />
      <ErrorLine message={sp.error} className="mb-4" />
      <Tiles
        items={[
          { term: "Active listings", value: String(count("active")) },
          { term: "Under contract", value: String(count("pending")) },
          { term: "Sold", value: String(count("sold")) },
          { term: "Median list price", value: money(median) },
        ]}
      />
      <section className="mt-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="eyebrow">Listing board</h2>
          <span className="tnum text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">{plural(rows.length, "listing")}</span>
        </div>
        <Board rows={rows} empty={<>No listings yet. Create one on the Listings page from a house the owner has shared with you.</>} />
      </section>
    </>
  );
}

