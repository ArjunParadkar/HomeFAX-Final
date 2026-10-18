import { oversight, records, type Property, type PropertyStats, type StageGrade, type Tx } from "@homefax/db";
type RiskBand = oversight.RiskBand;

/** The grades behind a set of houses, one query. */
export async function gradesFor(tx: Tx, rows: { property: Property }[]): Promise<Map<string, StageGrade[]>> {
  return records.listStageGradesForProperties(
    tx,
    rows.map((r) => r.property.id),
  );
}

export function riskCounts(stats: PropertyStats[]): Record<RiskBand, number> {
  const c: Record<RiskBand, number> = { low: 0, moderate: 0, elevated: 0, high: 0, unknown: 0 };
  for (const s of stats) c[oversight.riskProfile(s).band]++;
  return c;
}

/** Stage grades filmed since the first day of the current quarter. */
export function filmedThisQuarter(grades: Iterable<StageGrade[]>): number {
  const now = new Date();
  const q0 = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  let n = 0;
  for (const list of grades) for (const g of list) if (g.filmedAt >= q0) n++;
  return n;
}

export function stagesFigure(stats: PropertyStats): string {
  return `${stats.stagesFilmed} / ${stats.stagesTotal}`;
}

export function pointsFigure(stats: PropertyStats): string {
  return stats.pointsAssessed > 0 ? `${stats.pointsPassed} / ${stats.pointsAssessed}` : "—";
}
