import Link from "next/link";
import { ErrorLine } from "@homefax/ui";
import { access, orgs, oversight, properties, withService, type Scope } from "@homefax/db";
import { requestAccessAction } from "@/app/(workspace)/properties/actions";
import { Board, BoardFilters, filterRows, readFilter, type BoardRow } from "@/components/Board";
import PageTitle from "@/components/PageTitle";
import Panel from "@/components/Panel";
import { gradesFor, pointsFigure, stagesFigure } from "@/lib/board";
import { asWorkspace, requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Every house the institution can reach, by any path, as a board. Houses it
 * cannot see do not appear — the request form is how they come into view.
 */
export default async function PropertiesPage({ searchParams }: PageProps<"/properties">) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const filter = readFilter(sp);

  const data = await asWorkspace(async (tx, ws) => {
    const rows = q ? await properties.searchProperties(tx, q, 100) : await oversight.listReachableProperties(tx, ws.org.id);
    const grades = await gradesFor(tx, rows);
    const grants = await access.listGrantsForOrg(tx, ws.org.id);
    return { rows, grades, grants };
  });

  // Pending requests sit on houses the actor cannot see yet, so the count runs
  // as the service — after confirming membership of the institution under RLS.
  const ws = await requireWorkspace();
  const member = await asWorkspace((tx) => orgs.getMembership(tx, ws.org.id, ws.me.identity.id));
  const pending = member ? (await withService((tx) => access.listRequestsForOrgAsService(tx, ws.org.id))).filter((r) => r.request.status === "pending").length : 0;

  const granted = new Map<string, Scope>();
  for (const g of data.grants) granted.set(g.property.id, g.grant.scope);

  const all: BoardRow[] = data.rows.map((r) => ({
    property: r.property,
    stats: r.stats,
    grades: data.grades.get(r.property.id) ?? [],
    figures: [
      { term: "Stages", value: stagesFigure(r.stats) },
      { term: "Points", value: pointsFigure(r.stats) },
    ],
    status: granted.has(r.property.id)
      ? { label: `${access.SCOPE_LABEL[granted.get(r.property.id)!]} grant`, tone: "good" }
      : r.stats.flaggedStages > 0
        ? { label: `${r.stats.flaggedStages} flagged`, tone: "bad" }
        : r.stats.stagesInFlight > 0
          ? { label: "Model building", tone: "neutral" }
          : undefined,
  }));
  const rows = filterRows(all, filter);

  return (
    <>
      <PageTitle
        eyebrow="Properties"
        title="The board"
        subtitle="Every house this institution can reach — by grant, by jurisdiction, or as a party to the record. A house you cannot see is not here; ask the owner for access below."
        actions={
          <form method="get" action="/properties" className="flex items-center gap-2">
            <label className="sr-only" htmlFor="q">
              Search by address
            </label>
            <input id="q" name="q" defaultValue={q} placeholder="Search address, city, ZIP" className="input input-sm w-[16rem]" />
            <button type="submit" className="btn btn-secondary btn-sm">
              Search
            </button>
          </form>
        }
      />
      <ErrorLine message={sp.error} className="mb-4" />

      <BoardFilters action={q ? `/properties?q=${encodeURIComponent(q)}` : "/properties"} filter={filter} total={all.length} shown={rows.length} />
      <Board
        rows={rows}
        empty={
          q ? (
            <>
              Nothing you can see matches “{q}”. <Link href="/properties" className="underline">Clear the search</Link>, or request access to the address below.
            </>
          ) : all.length === 0 ? (
            <>No houses are in view yet. Request access to one below; a municipality sees its jurisdiction as soon as it is set on the Team page.</>
          ) : (
            <>No house matches these filters.</>
          )
        }
      />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Request access to a property" meta={pending > 0 ? <Link href="/requests" className="underline">{pending} pending</Link> : undefined}>
          <form action={requestAccessAction} className="space-y-4">
            <div>
              <label className="label block" htmlFor="address">
                Address
              </label>
              <input id="address" name="address" required placeholder="22 Cedar Ln, Bentonville, AR 72712" className="input mt-1.5" />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Street, city, state, ZIP on one line. The address is looked up without revealing anything about the house; the owner decides.</p>
            </div>
            <fieldset>
              <legend className="label">Scope</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(["summary", "ledger", "full"] as const).map((s) => (
                  <label key={s} className="flex cursor-pointer gap-2.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-2.5 has-[:checked]:border-[var(--accent)]">
                    <input type="radio" name="scope" value={s} defaultChecked={s === "ledger"} className="mt-0.5 accent-[var(--accent)]" />
                    <span>
                      <span className="block text-[0.875rem] font-semibold">{access.SCOPE_LABEL[s]}</span>
                      <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-[var(--ink-2)]">{access.SCOPE_BLURB[s]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="label block" htmlFor="purpose">
                Purpose
              </label>
              <textarea id="purpose" name="purpose" required minLength={8} rows={2} placeholder="Homeowners policy quote for the new owner" className="input mt-1.5" />
            </div>
            <button type="submit" className="btn btn-primary">
              Send the request
            </button>
          </form>
        </Panel>
        <Panel title="How a house comes into view">
          <ul className="space-y-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            <li>
              <span className="font-medium text-[var(--ink)]">Grant.</span> The owner approves your request at a scope — summary, ledger, or full — and can revoke it any time.
            </li>
            <li>
              <span className="font-medium text-[var(--ink)]">Jurisdiction.</span> A municipality sees every house inside its territory at ledger scope by statute.
            </li>
            <li>
              <span className="font-medium text-[var(--ink)]">Project.</span> A company on the build record sees the whole record.
            </li>
            <li>
              <span className="font-medium text-[var(--ink)]">Every look is logged.</span> The owner sees who opened their house; your own <Link href="/audit" className="underline">audit page</Link> shows what your members opened.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
