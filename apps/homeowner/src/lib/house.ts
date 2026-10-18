import type { PartLine, QualityReport, StageId } from "@homefax/core";
import { STAGES } from "@homefax/core";
import { viewProperty } from "@homefax/app-kit";
import { properties, records, type Property, type PropertyStats, type Scope, type Tx } from "@homefax/db";
import type { StageGrade, PartLineRow } from "@homefax/db";
import { formatDay } from "./format";

/**
 * The house as the homeowner pages read it: the property row, its stats row,
 * and the eleven ticks of the comb. One shape for the owner's pages and the
 * public report, so the house card draws the same from either side.
 */

export type TickState = "graded" | "done" | "working" | "failed" | "open";

export type Tick = {
  stage: StageId;
  label: string;
  short: string;
  state: TickState;
  grade: QualityReport["grade"] | null;
  score: number | null;
};

export type House = {
  property: Property;
  stats: PropertyStats;
  ticks: Tick[];
};

export function addressLine(p: Pick<Property, "line1" | "line2">): string {
  return p.line2 ? `${p.line1}, ${p.line2}` : p.line1;
}

export function placeLine(p: Pick<Property, "city" | "state" | "postalCode">): string {
  return `${p.city}, ${p.state} ${p.postalCode}`;
}

/**
 * Ticks for an owner (or anyone with ledger scope): capture states carry the
 * in-flight and failed cases; grades carry the colour.
 */
export async function ticksForOwner(tx: Tx, propertyId: string): Promise<Tick[]> {
  const statuses = await records.stageStatuses(tx, propertyId);
  return statuses.map((s) => ({
    stage: s.stage,
    label: s.label,
    short: s.short,
    state: s.grade ? "graded" : s.state === "done" ? "done" : s.state,
    grade: s.grade,
    score: s.score,
  }));
}

/**
 * Ticks from grades alone — what a summary-scope reader can see. Captures are
 * hidden at that scope, so an ungraded stage simply reads as open.
 */
export function ticksFromGrades(grades: StageGrade[]): Tick[] {
  const byStage = new Map(grades.map((g) => [g.stage, g]));
  return STAGES.map((s) => {
    const g = byStage.get(s.id);
    return {
      stage: s.id,
      label: s.label,
      short: s.short,
      state: g ? "graded" : "open",
      grade: g?.grade ?? null,
      score: g?.score ?? null,
    };
  });
}

/** "7 of 11 stages on file · last filmed 12 Sep" */
export function standingLine(stats: PropertyStats): string {
  const head = `${stats.stagesFilmed} of ${stats.stagesTotal} stages on file`;
  if (stats.stagesInFlight > 0) return `${head} · ${stats.stagesInFlight} being built`;
  if (stats.lastCaptureAt) return `${head} · last filmed ${formatDay(stats.lastCaptureAt)}`;
  return `${head} · nothing filmed yet`;
}

/** The flattened part_lines rows back into the shape PartsTable draws. */
export function toPartLines(rows: PartLineRow[]): PartLine[] {
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category as PartLine["category"],
    spec: r.spec ?? undefined,
    quantity: r.quantity,
    unit: r.unit as PartLine["unit"],
    basis: r.basis,
    derivation: r.derivation,
    confidence: r.confidence,
    unitCostUsd: r.unitCostCents != null ? r.unitCostCents / 100 : undefined,
    stage: r.stage,
    identified: r.identified ?? undefined,
  }));
}

export type OpenedHouse = { property: Property; stats: PropertyStats; scope: Scope };

/**
 * Open a house for a signed-in reader: resolve the slug under row-level
 * security, log the look if the reader is not the owner, and return null when
 * they cannot see it at all (the page then 404s). Every /home/[slug] page
 * starts here.
 */
export async function openHouse(tx: Tx, identityId: string, slug: string, path: string): Promise<OpenedHouse | null> {
  const property = await properties.getPropertyBySlug(tx, slug);
  if (!property) return null;
  const view = await viewProperty(tx, property.id, { identityId }, { app: "homeowner", path });
  if (!view) return null;
  const stats = await properties.getStats(tx, property.id);
  if (!stats) return null;
  return { property, stats, scope: view.scope };
}
