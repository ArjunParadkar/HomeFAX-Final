import Link from "next/link";
import { ErrorLine, GradeChip } from "@homefax/ui";
import { STAGES, stageDef } from "@homefax/core";
import { oversight, type LoanDraw } from "@homefax/db";
import { decideDrawAction, requestDrawAction } from "@/app/(workspace)/portfolio/actions";
import { DRAW_TONE, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { date, masked, money, plural, streetOf, titleWord } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const STATUSES: LoanDraw["status"][] = ["requested", "verified", "released", "held", "rejected"];

/** Every draw across the portfolio, filterable by status and stage, with the decision controls on the open ones. */
export default async function DrawsPage({ searchParams }: PageProps<"/draws">) {
  await requireKind("lender");
  const sp = await searchParams;
  const status = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? "";
  const stage = (Array.isArray(sp.stage) ? sp.stage[0] : sp.stage) ?? "";
  const data = await asWorkspace(async (tx, ws) => {
    const all = await oversight.listDrawsForOrg(tx, ws.org.id);
    const live = new Map<string, oversight.DrawRecommendation>();
    for (const d of all) if (d.draw.status === "requested") live.set(d.draw.id, await oversight.recommendDraw(tx, d.property.id, d.draw.stage));
    const holdings = await oversight.listHoldings(tx, ws.org.id);
    return { all, live, holdings };
  });
  const rows = data.all.filter((d) => (!status || d.draw.status === status) && (!stage || d.draw.stage === stage));
  const total = rows.reduce((s, d) => s + d.draw.amountCents, 0);

  return (
    <>
      <PageTitle eyebrow="Draws" title="Draw ledger" subtitle="Construction-loan disbursements, each tied to the stage it funds and decided against that stage's graded record." actions={<Link href="/portfolio" className="btn btn-secondary btn-sm">Portfolio</Link>} />
      <ErrorLine message={sp.error} className="mb-4" />

      <form method="get" action="/draws" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label block" htmlFor="f-status">
            Status
          </label>
          <select id="f-status" name="status" defaultValue={status} className="input input-sm select mt-1 w-auto">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleWord(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label block" htmlFor="f-stage">
            Stage
          </label>
          <select id="f-stage" name="stage" defaultValue={stage} className="input input-sm select mt-1 w-auto">
            <option value="">Any stage</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary btn-sm">
          Filter
        </button>
        {(status || stage) && (
          <Link href="/draws" className="btn btn-sm text-[var(--ink-2)]">
            Clear
          </Link>
        )}
        <span className="tnum ml-auto text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
          {plural(rows.length, "draw")} · {money(total)}
        </span>
      </form>

      <Panel title="Draws" meta={`${data.all.filter((d) => d.draw.status === "requested").length} awaiting decision`} flush className="mb-5">
        {rows.length === 0 ? (
          <Empty>No draw matches. Record a request below against one of your holdings.</Empty>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Address</th>
                  <th className="num">Amount</th>
                  <th>Grade</th>
                  <th>Record says</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Decided</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const live = data.live.get(d.draw.id);
                  const stored = d.draw.recommendation?.split(":")[0];
                  return (
                    <tr key={d.draw.id}>
                      <td className="font-medium">{stageDef(d.draw.stage).label}</td>
                      <td>
                        <Link href={`/properties/${d.property.slug}?tab=draws`}>{streetOf(d.property)}</Link>
                      </td>
                      <td className="num">{money(d.draw.amountCents)}</td>
                      <td>{live?.grade ? <GradeChip grade={live.grade} size="sm" /> : "—"}</td>
                      <td>
                        {live ? (
                          <StatusWord tone={live.recommendation === "release" ? "good" : "warn"}>{titleWord(live.recommendation)}</StatusWord>
                        ) : stored ? (
                          <span className="text-[var(--ink-3)]">{titleWord(stored)} at request</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <StatusWord tone={DRAW_TONE[d.draw.status]}>{titleWord(d.draw.status)}</StatusWord>
                      </td>
                      <td className="mono">{date(d.draw.requestedAt)}</td>
                      <td className="mono">{date(d.draw.decidedAt)}</td>
                      <td className="num">
                        <div className="flex justify-end gap-1.5">
                          {d.draw.status === "requested" && (
                            <form action={decideDrawAction} className="flex gap-1.5">
                              <input type="hidden" name="drawId" value={d.draw.id} />
                              <input type="hidden" name="back" value="/draws" />
                              <button type="submit" name="status" value="released" className="btn btn-primary btn-sm">
                                Release
                              </button>
                              <button type="submit" name="status" value="held" className="btn btn-secondary btn-sm">
                                Hold
                              </button>
                            </form>
                          )}
                          <Link href={`/draws/${d.draw.id}`} className="btn btn-secondary btn-sm">
                            Detail
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {data.holdings.length > 0 && (
        <Panel title="Record a draw request" meta="On behalf of the builder, against a holding">
          <form action={requestDrawAction} className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label className="label block" htmlFor="holding">
                Holding
              </label>
              <select id="holding" name="holdingId" required className="input input-sm select mt-1.5" defaultValue={data.holdings[0].row.id}>
                {data.holdings.map((h) => (
                  <option key={h.row.id} value={h.row.id}>
                    {streetOf(h.property)} · {titleWord(h.row.kind)} · {masked(oversight.dec(h.row.loanRefEnc))}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block" htmlFor="stage">
                Stage funded
              </label>
              <select id="stage" name="stage" required className="input input-sm select mt-1.5">
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block" htmlFor="amount">
                Amount
              </label>
              <input id="amount" name="amount" required inputMode="decimal" placeholder="$ 25,000" className="input input-sm tnum mt-1.5" />
            </div>
            <button type="submit" className="btn btn-secondary btn-sm">
              Record request
            </button>
          </form>
        </Panel>
      )}
    </>
  );
}
