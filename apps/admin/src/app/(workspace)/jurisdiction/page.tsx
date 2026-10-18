import Link from "next/link";
import { orgs, oversight } from "@homefax/db";
import { Board, BoardFilters, filterRows, readFilter, type BoardRow } from "@/components/Board";
import PageTitle from "@/components/PageTitle";
import { gradesFor, pointsFigure, stagesFigure } from "@/lib/board";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** The municipality's board: every house inside its territory, filterable, exportable. */
export default async function JurisdictionPage({ searchParams }: PageProps<"/jurisdiction">) {
  await requireKind("municipality");
  const sp = await searchParams;
  const filter = readFilter(sp);
  const data = await asWorkspace(async (tx, ws) => {
    const rows = await oversight.listJurisdictionProperties(tx, ws.org.id);
    const grades = await gradesFor(tx, rows);
    const jurisdictions = await orgs.listJurisdictions(tx, ws.org.id);
    return { rows, grades, jurisdictions };
  });

  const all: BoardRow[] = data.rows.map((r) => ({
    property: r.property,
    stats: r.stats,
    grades: data.grades.get(r.property.id) ?? [],
    figures: [
      { term: "Stages", value: stagesFigure(r.stats) },
      { term: "Points", value: pointsFigure(r.stats) },
    ],
    status:
      r.stats.flaggedStages > 0
        ? { label: `${r.stats.flaggedStages} flagged`, tone: "bad" }
        : r.stats.verifiedStages > 0 && r.stats.verifiedStages >= r.stats.stagesFilmed
          ? { label: "All filmed stages verified", tone: "good" }
          : r.stats.stagesFilmed > r.stats.verifiedStages
            ? { label: `${r.stats.stagesFilmed - r.stats.verifiedStages} awaiting review`, tone: "warn" }
            : { label: "Nothing filmed yet", tone: "neutral" },
  }));
  const rows = filterRows(all, filter);
  const qs = new URLSearchParams(Object.entries(filter).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const territory = data.jurisdictions.map((j) => [j.city, j.county ? `${j.county} County` : null, j.postalCode].filter(Boolean).join(" · ") + `, ${j.state}`).join(" / ");

  return (
    <>
      <PageTitle
        eyebrow="Jurisdiction"
        title="Houses in the territory"
        subtitle={territory ? `${territory}. Every house here opens at ledger scope by statute.` : "No jurisdiction is set yet — add one on the Team page."}
        actions={
          <>
            <a href={`/jurisdiction/export${qs ? `?${qs}` : ""}`} className="btn btn-secondary btn-sm" download>
              Export CSV
            </a>
            <Link href="/team" className="btn btn-secondary btn-sm">
              Edit jurisdictions
            </Link>
          </>
        }
      />
      <BoardFilters action="/jurisdiction" filter={filter} total={all.length} shown={rows.length} />
      <Board rows={rows} empty={all.length === 0 ? <>No house falls inside the jurisdiction yet. Check the territory on the Team page.</> : <>No house matches these filters.</>} />
    </>
  );
}
