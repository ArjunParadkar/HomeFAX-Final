import Link from "next/link";
import { GradeChip } from "@homefax/ui";
import { STAGES, isStageId, toGrade } from "@homefax/core";
import type { Property, PropertyStats, StageGrade } from "@homefax/db";
import { Comb, StatusWord } from "@/components/bits";
import { cityOf, streetOf } from "@/lib/format";

/**
 * The board — the admin app's signature element. A grid of house tiles, each
 * a miniature of the homeowner's house card: the address, the 11-tick comb
 * lit in grade colours, the grade chip, two mono figures. The same tile draws
 * a portfolio, a jurisdiction, a book of policies, or a set of listings; only
 * the two figures change.
 */

export type Figure = { term: string; value: string };
export type BoardRow = {
  property: Property;
  stats: PropertyStats;
  grades: Pick<StageGrade, "stage" | "grade">[];
  figures: [Figure, Figure];
  /** A status word under the figures, in the reserved colours. */
  status?: { label: string; tone: "good" | "bad" | "neutral" | "warn" };
  /** Where the tile goes. Defaults to the property page. */
  href?: string;
};

export type BoardFilter = { grade?: string; stage?: string; status?: string };

export const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "active", label: "Under construction" },
  { value: "complete", label: "All 11 stages on file" },
  { value: "in_flight", label: "Model building now" },
  { value: "flagged", label: "Flagged by the municipality" },
  { value: "unfilmed", label: "Nothing filmed yet" },
] as const;

export function houseGrade(stats: PropertyStats): "A" | "B" | "C" | "D" | "F" | null {
  return stats.meanScore == null ? null : toGrade(stats.meanScore);
}

/** Apply the board's three filters. Pure, so the CSV export uses the same rule as the grid. */
export function filterRows<T extends { stats: PropertyStats; grades: Pick<StageGrade, "stage" | "grade">[] }>(rows: T[], f: BoardFilter): T[] {
  return rows.filter((r) => {
    if (f.grade && houseGrade(r.stats) !== f.grade) return false;
    if (f.stage && isStageId(f.stage) && !r.grades.some((g) => g.stage === f.stage)) return false;
    switch (f.status) {
      case "active":
        return r.stats.stagesFilmed > 0 && r.stats.stagesFilmed < r.stats.stagesTotal;
      case "complete":
        return r.stats.stagesFilmed >= r.stats.stagesTotal;
      case "in_flight":
        return r.stats.stagesInFlight > 0;
      case "flagged":
        return r.stats.flaggedStages > 0;
      case "unfilmed":
        return r.stats.stagesFilmed === 0;
      default:
        return true;
    }
  });
}

export function readFilter(sp: Record<string, string | string[] | undefined>): BoardFilter {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) || undefined;
  return { grade: one("grade"), stage: one("stage"), status: one("status") };
}

export function HouseTile({ row }: { row: BoardRow }) {
  const grade = houseGrade(row.stats);
  const p = row.property;
  return (
    <Link href={row.href ?? `/properties/${p.slug}`} className="tile">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[0.9375rem] font-semibold leading-snug">{streetOf(p)}</span>
          <span className="tnum mt-0.5 block truncate text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">{cityOf(p)}</span>
        </span>
        {grade ? (
          <GradeChip grade={grade} size="sm" />
        ) : (
          <span className="chip" title="No stage graded yet">
            —
          </span>
        )}
      </div>
      <Comb grades={row.grades} />
      <dl className="tile-figures">
        {row.figures.map((f) => (
          <div key={f.term}>
            <dt>{f.term}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {row.status && (
        <div className="flex items-center justify-between gap-2">
          <StatusWord tone={row.status.tone}>{row.status.label}</StatusWord>
          <span className="tnum text-[0.625rem] text-[var(--ink-3)]">
            {row.stats.stagesFilmed}/{row.stats.stagesTotal}
          </span>
        </div>
      )}
    </Link>
  );
}

export function Board({ rows, empty }: { rows: BoardRow[]; empty: React.ReactNode }) {
  if (rows.length === 0) return <div className="card px-4 py-6 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{empty}</div>;
  return (
    <div className="board">
      {rows.map((r) => (
        <HouseTile key={`${r.property.id}:${r.href ?? ""}`} row={r} />
      ))}
    </div>
  );
}

/** A plain GET form: the browser carries the filter in the URL, the server does the filtering. */
export function BoardFilters({ action, filter, extra, total, shown }: { action: string; filter: BoardFilter; extra?: React.ReactNode; total: number; shown: number }) {
  const active = Boolean(filter.grade || filter.stage || filter.status);
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-2">
      <div>
        <label className="label block" htmlFor="f-grade">
          Grade
        </label>
        <select id="f-grade" name="grade" defaultValue={filter.grade ?? ""} className="input input-sm select mt-1 w-auto">
          <option value="">Any grade</option>
          {(["A", "B", "C", "D", "F"] as const).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label block" htmlFor="f-stage">
          Stage on file
        </label>
        <select id="f-stage" name="stage" defaultValue={filter.stage ?? ""} className="input input-sm select mt-1 w-auto">
          <option value="">Any stage</option>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label block" htmlFor="f-status">
          Status
        </label>
        <select id="f-status" name="status" defaultValue={filter.status ?? ""} className="input input-sm select mt-1 w-auto">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-secondary btn-sm">
        Filter
      </button>
      {active && (
        <Link href={action} className="btn btn-sm text-[var(--ink-2)]">
          Clear
        </Link>
      )}
      <span className="tnum ml-auto text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
        {shown} of {total} houses
      </span>
      {extra}
    </form>
  );
}
