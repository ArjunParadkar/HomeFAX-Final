import Link from "next/link";
import { ErrorLine, GradeChip } from "@homefax/ui";
import { oversight } from "@homefax/db";
import { createPolicyAction, updatePolicyStatusAction } from "@/app/(workspace)/policies/actions";
import { Board, type BoardRow } from "@/components/Board";
import { houseGrade } from "@/components/Board";
import { POLICY_TONE, RiskWord, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import PropertyPicker from "@/components/PropertyPicker";
import { gradesFor, pointsFigure } from "@/lib/board";
import { date, masked, money, plural, titleWord, todayIso } from "@/lib/format";
import { requireKind, asWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const KINDS = ["homeowners", "builders_risk", "flood", "umbrella", "commercial"] as const;
const STATUSES = ["quoted", "bound", "active", "lapsed", "cancelled"] as const;

/** The book of policies: as a board, as a ledger, and the form that adds one. */
export default async function PoliciesPage({ searchParams }: PageProps<"/policies">) {
  await requireKind("insurer");
  const sp = await searchParams;
  const preselect = Array.isArray(sp.property) ? sp.property[0] : sp.property;
  const data = await asWorkspace(async (tx, ws) => {
    const policies = await oversight.listPolicies(tx, ws.org.id);
    const grades = await gradesFor(tx, policies);
    const reachable = await oversight.listReachableProperties(tx, ws.org.id);
    return { policies, grades, reachable };
  });

  const seen = new Set<string>();
  const rows: BoardRow[] = [];
  for (const p of data.policies) {
    if (seen.has(p.property.id)) continue;
    seen.add(p.property.id);
    const mine = data.policies.filter((x) => x.property.id === p.property.id);
    const inForce = mine.filter((x) => x.row.status === "bound" || x.row.status === "active");
    rows.push({
      property: p.property,
      stats: p.stats,
      grades: data.grades.get(p.property.id) ?? [],
      figures: [
        { term: "Coverage", value: money(mine.reduce((s, x) => s + x.row.coverageCents, 0), { compact: true }) },
        { term: "Points", value: pointsFigure(p.stats) },
      ],
      status: inForce.length ? { label: `${inForce.length} in force`, tone: "good" } : { label: mine.map((x) => x.row.status).join(", "), tone: "neutral" },
      href: `/properties/${p.property.slug}?tab=underwriting`,
    });
  }

  return (
    <>
      <PageTitle eyebrow="Policies" title="Book of policies" subtitle="Every policy this institution has quoted, bound, or carries, with the house's record beside it." />
      <ErrorLine message={sp.error} className="mb-4" />

      <section className="mb-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="eyebrow">Houses on the book</h2>
          <span className="tnum text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">{plural(rows.length, "house")}</span>
        </div>
        <Board rows={rows} empty={<>No policies yet. Quote one below on a house the owner has shared with you.</>} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Policies" meta={plural(data.policies.length, "policy", "policies")} flush>
          {data.policies.length === 0 ? (
            <Empty>Nothing on the book.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>House</th>
                    <th>Kind</th>
                    <th>Ref</th>
                    <th>Status</th>
                    <th className="num">Coverage</th>
                    <th className="num">Premium</th>
                    <th>Effective</th>
                    <th>Grade</th>
                    <th>Risk</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.policies.map((p) => {
                    const g = houseGrade(p.stats);
                    return (
                      <tr key={p.row.id}>
                        <td>
                          <Link href={`/properties/${p.property.slug}?tab=underwriting`} className="font-medium">
                            {p.property.line1}
                          </Link>
                        </td>
                        <td>{titleWord(p.row.kind)}</td>
                        <td className="mono">{masked(oversight.dec(p.row.policyRefEnc))}</td>
                        <td>
                          <StatusWord tone={POLICY_TONE[p.row.status]}>{titleWord(p.row.status)}</StatusWord>
                        </td>
                        <td className="num">{money(p.row.coverageCents)}</td>
                        <td className="num">{money(p.row.premiumCents)}</td>
                        <td className="mono whitespace-nowrap">
                          {date(p.row.effectiveFrom)} – {date(p.row.effectiveTo)}
                        </td>
                        <td>{g ? <GradeChip grade={g} size="sm" /> : "—"}</td>
                        <td>
                          <RiskWord band={oversight.riskProfile(p.stats).band} />
                        </td>
                        <td className="num">
                          <form action={updatePolicyStatusAction} className="flex justify-end gap-1.5">
                            <input type="hidden" name="policyId" value={p.row.id} />
                            <select name="status" defaultValue={p.row.status} className="input input-sm select w-auto" aria-label="New status">
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

        <Panel title="Quote a policy">
          <form action={createPolicyAction} className="space-y-4">
            <PropertyPicker properties={data.reachable.map((r) => r.property)} selected={preselect} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label block" htmlFor="kind">
                  Kind
                </label>
                <select id="kind" name="kind" required className="input input-sm select mt-1.5" defaultValue="homeowners">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {titleWord(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="status">
                  Status
                </label>
                <select id="status" name="status" className="input input-sm select mt-1.5" defaultValue="quoted">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleWord(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="coverage">
                  Coverage
                </label>
                <input id="coverage" name="coverage" required inputMode="decimal" placeholder="$ 390,000" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="premium">
                  Annual premium
                </label>
                <input id="premium" name="premium" inputMode="decimal" placeholder="$ 2,400" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="effectiveFrom">
                  Effective from
                </label>
                <input id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={todayIso()} className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="effectiveTo">
                  Effective to
                </label>
                <input id="effectiveTo" name="effectiveTo" type="date" required className="input input-sm tnum mt-1.5" />
              </div>
            </div>
            <div>
              <label className="label block" htmlFor="policyRef">
                Policy reference <span className="normal-case tracking-normal">(stored encrypted, shown masked)</span>
              </label>
              <input id="policyRef" name="policyRef" placeholder="HO-2026-…" className="input input-sm tnum mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="notes">
                Notes
              </label>
              <textarea id="notes" name="notes" rows={2} className="input input-sm mt-1.5" />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              Add the policy
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
