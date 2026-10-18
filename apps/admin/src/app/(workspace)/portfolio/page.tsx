import Link from "next/link";
import { ErrorLine, GradeChip } from "@homefax/ui";
import { oversight } from "@homefax/db";
import { createHoldingAction, updateHoldingStatusAction } from "@/app/(workspace)/portfolio/actions";
import { Board, BoardFilters, filterRows, houseGrade, readFilter, type BoardRow } from "@/components/Board";
import { HOLDING_TONE, RiskWord, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import PropertyPicker from "@/components/PropertyPicker";
import { gradesFor } from "@/lib/board";
import { date, masked, money, pct, plural, titleWord, todayIso } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const KINDS = ["construction", "mortgage", "heloc", "bridge", "commercial"] as const;
const STATUSES = ["pipeline", "active", "paid_off", "default", "sold"] as const;

/** The portfolio: holdings as a board and a ledger, with the add-holding form. Loan references stay encrypted and print masked. */
export default async function PortfolioPage({ searchParams }: PageProps<"/portfolio">) {
  await requireKind("lender");
  const sp = await searchParams;
  const filter = readFilter(sp);
  const data = await asWorkspace(async (tx, ws) => {
    const holdings = await oversight.listHoldings(tx, ws.org.id);
    const grades = await gradesFor(tx, holdings);
    const draws = await oversight.listDrawsForOrg(tx, ws.org.id, ["requested"]);
    const reachable = await oversight.listReachableProperties(tx, ws.org.id);
    return { holdings, grades, draws, reachable };
  });
  const openDraws = new Map<string, number>();
  for (const d of data.draws) openDraws.set(d.holding.id, (openDraws.get(d.holding.id) ?? 0) + 1);

  const all: BoardRow[] = data.holdings.map((h) => {
    const risk = oversight.riskProfile(h.stats);
    return {
      property: h.property,
      stats: h.stats,
      grades: data.grades.get(h.property.id) ?? [],
      figures: [
        { term: "Principal", value: money(h.row.principalCents, { compact: true }) },
        { term: "Open draws", value: String(openDraws.get(h.row.id) ?? 0) },
      ],
      status: { label: `${titleWord(h.row.kind)} · ${risk.band === "unknown" ? "not graded" : `${risk.band} risk`}`, tone: risk.band === "low" ? "good" : risk.band === "high" || risk.band === "elevated" ? "bad" : risk.band === "moderate" ? "warn" : "neutral" },
      href: `/properties/${h.property.slug}?tab=draws`,
    };
  });
  const rows = filterRows(all, filter);
  const principal = data.holdings.filter((h) => h.row.status === "active" || h.row.status === "default").reduce((s, h) => s + h.row.principalCents, 0);

  return (
    <>
      <PageTitle eyebrow="Portfolio" title="Holdings" subtitle={`${plural(data.holdings.length, "holding")} · ${money(principal)} principal outstanding on active loans · ${data.draws.length} draws awaiting decision`} actions={<Link href="/draws" className="btn btn-secondary btn-sm">Open the draw ledger</Link>} />
      <ErrorLine message={sp.error} className="mb-4" />

      <BoardFilters action="/portfolio" filter={filter} total={all.length} shown={rows.length} />
      <Board rows={rows} empty={all.length === 0 ? <>No holdings yet. Add the first below from a house the owner has shared with you.</> : <>No holding matches these filters.</>} />

      <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Holdings ledger" meta={plural(data.holdings.length, "row")} flush>
          {data.holdings.length === 0 ? (
            <Empty>Nothing held.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Kind</th>
                    <th>Ref</th>
                    <th className="num">Principal</th>
                    <th className="num">Rate</th>
                    <th>Grade</th>
                    <th>Risk</th>
                    <th className="num">Open draws</th>
                    <th>Matures</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((h) => {
                    const g = houseGrade(h.stats);
                    return (
                      <tr key={h.row.id}>
                        <td>
                          <Link href={`/properties/${h.property.slug}?tab=draws`} className="font-medium">
                            {h.property.line1}
                          </Link>
                          <span className="block text-[0.6875rem] text-[var(--ink-3)]">{h.property.city}</span>
                        </td>
                        <td>{titleWord(h.row.kind)}</td>
                        <td className="mono">{masked(oversight.dec(h.row.loanRefEnc))}</td>
                        <td className="num">{money(h.row.principalCents)}</td>
                        <td className="num">{pct(h.row.rateBps)}</td>
                        <td>{g ? <GradeChip grade={g} size="sm" /> : "—"}</td>
                        <td>
                          <RiskWord band={oversight.riskProfile(h.stats).band} />
                        </td>
                        <td className="num">{openDraws.get(h.row.id) ?? 0}</td>
                        <td className="mono">{date(h.row.maturesAt)}</td>
                        <td>
                          <StatusWord tone={HOLDING_TONE[h.row.status]}>{titleWord(h.row.status)}</StatusWord>
                        </td>
                        <td className="num">
                          <form action={updateHoldingStatusAction} className="flex justify-end gap-1.5">
                            <input type="hidden" name="holdingId" value={h.row.id} />
                            <select name="status" defaultValue={h.row.status} className="input input-sm select w-auto" aria-label="New status">
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {titleWord(s)}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="btn btn-secondary btn-sm">
                              Set
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Add a holding">
          <form action={createHoldingAction} className="space-y-4">
            <PropertyPicker properties={data.reachable.map((r) => r.property)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label block" htmlFor="kind">
                  Kind
                </label>
                <select id="kind" name="kind" required defaultValue="construction" className="input input-sm select mt-1.5">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {titleWord(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="loanRef">
                  Loan reference <span className="normal-case tracking-normal">(encrypted)</span>
                </label>
                <input id="loanRef" name="loanRef" placeholder="CL-2026-…" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="principal">
                  Principal
                </label>
                <input id="principal" name="principal" required inputMode="decimal" placeholder="$ 420,000" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="rate">
                  Rate <span className="normal-case tracking-normal">(% per year)</span>
                </label>
                <input id="rate" name="rate" inputMode="decimal" placeholder="7.25" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="originatedAt">
                  Originated
                </label>
                <input id="originatedAt" name="originatedAt" type="date" defaultValue={todayIso()} className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="maturesAt">
                  Matures
                </label>
                <input id="maturesAt" name="maturesAt" type="date" className="input input-sm tnum mt-1.5" />
              </div>
            </div>
            <div>
              <label className="label block" htmlFor="notes">
                Notes
              </label>
              <textarea id="notes" name="notes" rows={2} className="input input-sm mt-1.5" />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              Add the holding
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
