import type { oversight } from "@homefax/db";
type GradeHistogram = oversight.GradeHistogram;
type RiskBand = oversight.RiskBand;
import { GRADE_VAR, RISK_COLOR, RISK_LABEL } from "@/components/bits";

/**
 * Charts per docs/specs/charts.md: one axis, thin marks, direct labels, the
 * grade and status colours reserved for grades and statuses, and the same
 * numbers in a table under "Show the numbers". Pure CSS in server components.
 */

type Segment = { key: string; label: string; value: number; color: string };

function NumbersTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [string, string][] }) {
  return (
    <details className="mt-3">
      <summary className="label inline-flex min-h-[1.75rem] cursor-pointer items-center">Show the numbers</summary>
      <table className="ledger mt-2 max-w-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>{head[0]}</th>
            <th className="num">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Share of a fixed set as one stacked bar, each segment labelled directly beneath. */
export function StackedBar({ segments, caption, unit = "houses" }: { segments: Segment[]; caption: string; unit?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <figure>
      {total === 0 ? (
        <div className="bar-track" aria-hidden>
          <span className="bar-seg w-full" style={{ background: "var(--surface-2)" }} />
        </div>
      ) : (
        <div className="bar-track" role="img" aria-label={`${caption}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.key} className="bar-seg" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label} · ${s.value}`} />
            ))}
        </div>
      )}
      <figcaption className="tnum mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.625rem] uppercase tracking-[0.1em] text-[var(--ink-3)]">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-[1px]" style={{ background: s.color }} aria-hidden />
            {s.label} <span className="text-[var(--ink)]">{s.value}</span>
          </span>
        ))}
        <span className="ml-auto">
          {total} {unit}
        </span>
      </figcaption>
      <NumbersTable caption={caption} head={["Band", "Count"]} rows={segments.map((s) => [s.label, String(s.value)])} />
    </figure>
  );
}

export function GradeBar({ hist }: { hist: GradeHistogram }) {
  const segs: Segment[] = (["A", "B", "C", "D", "F"] as const).map((g) => ({ key: g, label: g, value: hist[g], color: GRADE_VAR[g] }));
  return <StackedBar segments={segs} caption="Houses by grade" unit="graded houses" />;
}

export function RiskBar({ counts }: { counts: Record<RiskBand, number> }) {
  const order: RiskBand[] = ["low", "moderate", "elevated", "high", "unknown"];
  const segs: Segment[] = order.map((b) => ({ key: b, label: RISK_LABEL[b], value: counts[b], color: RISK_COLOR[b] }));
  return <StackedBar segments={segs} caption="Houses by risk band" />;
}

/** Magnitude across categories: horizontal bars, value printed at the bar end. */
export function HBars({ rows, caption, max }: { rows: { key: string; label: string; value: number; display?: string; color?: string }[]; caption: string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure>
      <ol className="space-y-1.5" aria-label={caption}>
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
            <span className="truncate text-[0.75rem] text-[var(--ink-2)]" title={r.label}>
              {r.label}
            </span>
            <span className="flex items-center gap-2">
              <span className="hbar" style={{ width: `${Math.max(1, (r.value / top) * 100)}%`, background: r.color ?? "var(--ink)", opacity: r.color ? 1 : 0.7 }} title={r.display ?? String(r.value)} />
              <span className="tnum shrink-0 text-[0.6875rem]">{r.display ?? r.value}</span>
            </span>
          </li>
        ))}
      </ol>
      <NumbersTable caption={caption} head={["Item", "Value"]} rows={rows.map((r) => [r.label, r.display ?? String(r.value)])} />
    </figure>
  );
}

/** A stat tile: one headline number in a ruled box. */
export function Tiles({ items }: { items: { term: string; value: string; note?: string }[] }) {
  return (
    <dl className="rule-grid grid-cols-2 overflow-hidden rounded-[var(--radius)] border border-[var(--line)] md:grid-cols-4">
      {items.map((it) => (
        <div key={it.term} className="field">
          <dt>{it.term}</dt>
          <dd className="text-[1.125rem]">{it.value}</dd>
          {it.note && <p className="mt-0.5 text-[0.6875rem] leading-snug text-[var(--ink-3)]">{it.note}</p>}
        </div>
      ))}
    </dl>
  );
}
