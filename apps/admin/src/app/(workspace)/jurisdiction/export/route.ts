import { STAGES, toGrade } from "@homefax/core";
import { oversight, withActor } from "@homefax/db";
import { filterRows, readFilter } from "@/components/Board";
import { gradesFor } from "@/lib/board";
import { currentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * The jurisdiction board as a CSV stream, same rows and the same filters as the
 * grid. Runs under the signed-in actor; RLS is the authorisation.
 */
export async function GET(request: Request) {
  const ws = await currentWorkspace();
  if (!ws) return new Response("Sign in first", { status: 401 });
  if (ws.org.kind !== "municipality") return new Response("Only a municipality exports its jurisdiction", { status: 403 });
  const url = new URL(request.url);
  const filter = readFilter(Object.fromEntries(url.searchParams.entries()));

  const rows = await withActor({ identityId: ws.me.identity.id }, async (tx) => {
    const list = await oversight.listJurisdictionProperties(tx, ws.org.id);
    const grades = await gradesFor(tx, list);
    return filterRows(
      list.map((r) => ({ ...r, grades: grades.get(r.property.id) ?? [] })),
      filter,
    );
  });

  const head = ["address", "city", "state", "zip", "kind", "year_built", "grade", "mean_score", "stages_filmed", "points_passed", "points_assessed", "critical_findings", "open_safety", "open_moisture", "verified_stages", "flagged_stages", "last_filmed", ...STAGES.map((s) => `stage_${s.id}`)];
  const csv = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(head.join(",") + "\n"));
      for (const r of rows) {
        const by = new Map(r.grades.map((g) => [g.stage, g]));
        const p = r.property;
        const s = r.stats;
        const line = [
          p.line2 ? `${p.line1}, ${p.line2}` : p.line1,
          p.city,
          p.state,
          p.postalCode,
          p.kind,
          p.yearBuilt,
          s.meanScore == null ? "" : toGrade(s.meanScore),
          s.meanScore == null ? "" : Math.round(s.meanScore),
          s.stagesFilmed,
          s.pointsPassed,
          s.pointsAssessed,
          s.criticalFindings,
          s.openSafetyItems,
          s.openMoistureItems,
          s.verifiedStages,
          s.flaggedStages,
          s.lastCaptureAt?.toISOString().slice(0, 10) ?? "",
          ...STAGES.map((st) => {
            const g = by.get(st.id);
            return g ? `${g.grade} ${Math.round(g.score)}` : "";
          }),
        ];
        controller.enqueue(encoder.encode(line.map(csv).join(",") + "\n"));
      }
      controller.close();
    },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="homefax-jurisdiction-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
