import Link from "next/link";
import { ErrorLine, GradeChip } from "@homefax/ui";
import { orgs, oversight } from "@homefax/db";
import { createListingAction } from "@/app/(workspace)/listings/actions";
import { Board, houseGrade, type BoardRow } from "@/components/Board";
import { LISTING_TONE, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import PropertyPicker from "@/components/PropertyPicker";
import { gradesFor, pointsFigure } from "@/lib/board";
import { date, money, plural, titleWord, todayIso } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "active", "pending", "sold", "withdrawn"] as const;

/** Listings as a board and a ledger, and the form that opens one. */
export default async function ListingsPage({ searchParams }: PageProps<"/listings">) {
  await requireKind("brokerage");
  const sp = await searchParams;
  const preselect = Array.isArray(sp.property) ? sp.property[0] : sp.property;
  const data = await asWorkspace(async (tx, ws) => {
    const listings = await oversight.listListings(tx, ws.org.id);
    const grades = await gradesFor(tx, listings);
    const reachable = await oversight.listReachableProperties(tx, ws.org.id);
    const members = await orgs.listMembers(tx, ws.org.id);
    return { ws, listings, grades, reachable, members };
  });
  const agentName = new Map(data.members.map((m) => [m.profile.identityId, m.profile.name]));

  const rows: BoardRow[] = data.listings.map((l) => ({
    property: l.property,
    stats: l.stats,
    grades: data.grades.get(l.property.id) ?? [],
    figures: [
      { term: "List price", value: money(l.row.listPriceCents) },
      { term: "Points", value: pointsFigure(l.stats) },
    ],
    status: { label: `${titleWord(l.row.status)}${l.row.shareLinkId ? " · buyer report" : ""}`, tone: LISTING_TONE[l.row.status] },
    href: `/listings/${l.row.id}`,
  }));

  return (
    <>
      <PageTitle eyebrow="Listings" title="Listings" subtitle="Houses this brokerage lists, each with its record behind it. A buyer report is a 90-day ledger-scope link the owner has let you issue." />
      <ErrorLine message={sp.error} className="mb-4" />

      <section className="mb-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="eyebrow">Listing board</h2>
          <span className="tnum text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">{plural(rows.length, "listing")}</span>
        </div>
        <Board rows={rows} empty={<>No listings yet. Open one below on a house the owner has shared with you.</>} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="All listings" meta={plural(data.listings.length, "listing")} flush>
          {data.listings.length === 0 ? (
            <Empty>Nothing listed.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>House</th>
                    <th>Status</th>
                    <th className="num">List price</th>
                    <th>MLS</th>
                    <th>Agent</th>
                    <th>Listed</th>
                    <th>Grade</th>
                    <th>Buyer report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.listings.map((l) => {
                    const g = houseGrade(l.stats);
                    return (
                      <tr key={l.row.id}>
                        <td>
                          <Link href={`/listings/${l.row.id}`} className="font-medium">
                            {l.property.line1}
                          </Link>
                          <span className="block text-[0.6875rem] text-[var(--ink-3)]">{l.property.city}</span>
                        </td>
                        <td>
                          <StatusWord tone={LISTING_TONE[l.row.status]}>{titleWord(l.row.status)}</StatusWord>
                        </td>
                        <td className="num">{money(l.row.listPriceCents)}</td>
                        <td className="mono">{l.row.mlsRef ?? "—"}</td>
                        <td>{l.row.agentIdentityId ? agentName.get(l.row.agentIdentityId) ?? "—" : "—"}</td>
                        <td className="mono">{date(l.row.listedAt)}</td>
                        <td>{g ? <GradeChip grade={g} size="sm" /> : "—"}</td>
                        <td>{l.row.shareLinkId ? <StatusWord tone="good">Issued</StatusWord> : <span className="text-[var(--ink-3)]">Not yet</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Open a listing">
          <form action={createListingAction} className="space-y-4">
            <PropertyPicker properties={data.reachable.map((r) => r.property)} selected={preselect} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label block" htmlFor="listPrice">
                  List price
                </label>
                <input id="listPrice" name="listPrice" inputMode="decimal" placeholder="$ 485,000" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="mlsRef">
                  MLS reference
                </label>
                <input id="mlsRef" name="mlsRef" placeholder="NWA-…" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="agentIdentityId">
                  Agent
                </label>
                <select id="agentIdentityId" name="agentIdentityId" className="input input-sm select mt-1.5" defaultValue={data.ws.me.identity.id}>
                  {data.members.map((m) => (
                    <option key={m.profile.identityId} value={m.profile.identityId}>
                      {m.profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="status">
                  Status
                </label>
                <select id="status" name="status" className="input input-sm select mt-1.5" defaultValue="active">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleWord(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="listedAt">
                  Listed on
                </label>
                <input id="listedAt" name="listedAt" type="date" defaultValue={todayIso()} className="input input-sm tnum mt-1.5" />
              </div>
            </div>
            <div>
              <label className="label block" htmlFor="notes">
                Notes
              </label>
              <textarea id="notes" name="notes" rows={2} className="input input-sm mt-1.5" />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              Open the listing
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
