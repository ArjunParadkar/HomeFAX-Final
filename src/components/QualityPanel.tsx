import type {
  CheckpointCategory,
  CheckpointResult,
  CheckpointStatus,
  Finding,
  QualityReport,
} from "@/lib/types";
import { GradeStamp } from "./Grade";

/**
 * The inspection side of the record: the stamp, the 50-point ledger, the
 * weighted rubric, and the findings. Everything here is a verdict with a
 * receipt attached — no verdict is shown without the evidence that produced it.
 */

const DIMENSION_LABEL: Record<string, string> = {
  capture: "Capture",
  geometry: "Geometry",
  workmanship: "Workmanship",
  compliance: "Compliance",
};

const SEVERITY_STYLE: Record<Finding["severity"], { label: string; color: string }> = {
  critical: { label: "Critical", color: "var(--grade-f)" },
  major: { label: "Major", color: "var(--grade-d)" },
  minor: { label: "Minor", color: "var(--grade-c)" },
  info: { label: "Note", color: "var(--ink-3)" },
};

const SOURCE_LABEL: Record<Finding["source"], string> = {
  geometry: "measured",
  vision: "reviewed",
  capture: "capture",
};

const STATUS_COLOR: Record<CheckpointStatus, string> = {
  pass: "var(--grade-a)",
  attention: "var(--grade-c)",
  fail: "var(--grade-f)",
  not_assessable: "var(--ink-3)",
};

const STATUS_WORD: Record<CheckpointStatus, string> = {
  pass: "Passed",
  attention: "Attention",
  fail: "Failed",
  not_assessable: "Not assessable",
};

/** Build order, so the ledger reads the way the house goes together. */
const CATEGORY_ORDER: CheckpointCategory[] = [
  "structure",
  "envelope",
  "moisture",
  "mechanical",
  "surfaces",
  "safety",
  "capture",
];

const CATEGORY_LABEL: Record<CheckpointCategory, string> = {
  structure: "Structure",
  envelope: "Envelope",
  moisture: "Moisture",
  mechanical: "Mechanical",
  surfaces: "Surfaces",
  safety: "Safety",
  capture: "Record integrity",
};

const LEDGER_SIZE = 50;

export default function QualityPanel({
  report,
  stageLabel,
}: {
  report: QualityReport;
  stageLabel: string;
}) {
  const caption = report.visionAvailable
    ? `Scored on measured geometry and a visual review of the keyframes. ${report.findings.length} finding${
        report.findings.length === 1 ? "" : "s"
      } across ${report.dimensions.length} weighted dimensions.`
    : (report.visionNote ??
      "Scored on measured geometry only. The visual review did not run, so workmanship and compliance are left out rather than assumed good.");

  const counts = tally(report);

  return (
    <div className="space-y-4">
      <GradeStamp
        score={report.score}
        grade={report.grade}
        stageLabel={stageLabel}
        caption={caption}
        tally={counts ? `${counts.passed} of ${counts.assessed} assessed points passed` : undefined}
      />

      {report.checkpoints && report.checkpoints.length > 0 && (
        <CheckpointLedger checkpoints={report.checkpoints} report={report} />
      )}

      {report.dimensions.length > 0 && (
        <section className="card overflow-hidden">
          <header className="px-4 pb-2.5 pt-3.5">
            <h3 className="eyebrow">Weighted rubric</h3>
          </header>
          <ul className="border-t border-[var(--line)]">
            {report.dimensions.map((d) => (
              <li
                key={d.dimension}
                className="border-b border-[var(--line)] px-4 py-3 last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[0.875rem] font-medium">
                    {DIMENSION_LABEL[d.dimension] ?? d.dimension}
                  </span>
                  <span className="tnum shrink-0 text-[0.8125rem] font-medium">
                    {Math.round(d.score)}
                    <span className="text-[var(--ink-3)]">
                      {" "}
                      · {Math.round(d.weight * 100)}% weight
                    </span>
                  </span>
                </div>
                <div className="mt-2 h-[3px] overflow-hidden rounded-[1px] bg-[var(--surface-2)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.max(2, Math.min(100, Math.round(d.score)))}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                  {d.basis}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.findings.length > 0 && (
        <section className="card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-3.5">
            <h3 className="eyebrow">Findings</h3>
            <span className="tnum text-[0.625rem] text-[var(--ink-3)]">
              {report.findings.length}
            </span>
          </header>
          <ul className="border-t border-[var(--line)]">
            {report.findings.map((f) => {
              const s = SEVERITY_STYLE[f.severity];
              return (
                <li
                  key={f.id}
                  className="border-b border-[var(--line)] px-4 py-3.5 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="chip"
                      style={{
                        color: s.color,
                        borderColor: `color-mix(in oklab, ${s.color} 55%, transparent)`,
                        background: `color-mix(in oklab, ${s.color} 10%, transparent)`,
                      }}
                    >
                      {s.label}
                    </span>
                    <span className="chip">{SOURCE_LABEL[f.source]}</span>
                    {f.keyframeIndex != null && (
                      <span className="chip">frame {f.keyframeIndex + 1}</span>
                    )}
                  </div>
                  <p className="mt-2 text-[0.9375rem] font-semibold leading-snug">{f.title}</p>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                    {f.detail}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------ the ledger ------------------------------ */

function tally(report: QualityReport) {
  const list = report.checkpoints;
  if (!list || list.length === 0) return null;
  const assessed =
    report.checkpointsAssessed ?? list.filter((c) => c.status !== "not_assessable").length;
  const passed = report.checkpointsPassed ?? list.filter((c) => c.status === "pass").length;
  const applicable = report.checkpointsApplicable ?? list.length;
  return { assessed, passed, applicable };
}

/**
 * All 50 points, always. Each stage lights the subset that is visible while it
 * is open; the rest stay dim so the reader can see what this stage could not
 * speak to. The comb at the top is the same notation used for stages on a
 * record — one tick per item in a fixed set.
 */
export function CheckpointLedger({
  checkpoints,
  report,
}: {
  checkpoints: CheckpointResult[];
  report: QualityReport;
}) {
  const counts = tally(report) ?? {
    assessed: checkpoints.filter((c) => c.status !== "not_assessable").length,
    passed: checkpoints.filter((c) => c.status === "pass").length,
    applicable: checkpoints.length,
  };

  const byNum = new Map(checkpoints.map((c) => [c.num, c]));
  const byStatus = (s: CheckpointStatus) => checkpoints.filter((c) => c.status === s).length;

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    rows: checkpoints.filter((c) => c.category === cat).sort((a, b) => a.num - b.num),
  })).filter((g) => g.rows.length > 0);

  return (
    <section className="card overflow-hidden">
      <header className="px-4 pb-3.5 pt-3.5">
        <h3 className="eyebrow">50-point ledger</h3>
        <p className="mt-2 text-[1.0625rem] font-semibold leading-snug">
          <span className="tnum">{counts.passed}</span> of{" "}
          <span className="tnum">{counts.assessed}</span> assessed points passed
        </p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          <span className="tnum">{counts.applicable}</span> of {LEDGER_SIZE} points apply while this
          stage is open.
          {counts.applicable - counts.assessed > 0 && (
            <>
              {" "}
              <span className="tnum">{counts.applicable - counts.assessed}</span> could not be
              assessed from this capture.
            </>
          )}
        </p>

        <div className="comb comb-50 mt-3.5" aria-hidden>
          {Array.from({ length: LEDGER_SIZE }, (_, i) => {
            const c = byNum.get(i + 1);
            return (
              <span
                key={i}
                className="tick"
                style={c ? { background: STATUS_COLOR[c.status] } : undefined}
              />
            );
          })}
        </div>

        <p
          className="tnum mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[0.5625rem] uppercase"
          style={{ letterSpacing: "0.1em" }}
        >
          <LegendItem color={STATUS_COLOR.pass} label="pass" n={byStatus("pass")} />
          <LegendItem color={STATUS_COLOR.attention} label="attention" n={byStatus("attention")} />
          <LegendItem color={STATUS_COLOR.fail} label="fail" n={byStatus("fail")} />
          <LegendItem
            color={STATUS_COLOR.not_assessable}
            label="no data"
            n={byStatus("not_assessable")}
          />
          <LegendItem color="var(--line)" label="n/a here" n={LEDGER_SIZE - checkpoints.length} />
        </p>
      </header>

      {grouped.map(({ category, rows }) => {
        const pass = rows.filter((r) => r.status === "pass").length;
        const assessed = rows.filter((r) => r.status !== "not_assessable").length;
        return (
          <div key={category} className="border-t border-[var(--line)]">
            <div className="flex items-baseline justify-between gap-3 bg-[var(--surface-2)] px-4 py-2">
              <h4 className="label">{CATEGORY_LABEL[category]}</h4>
              <span className="tnum text-[0.625rem] text-[var(--ink-3)]">
                {pass}/{assessed || 0}
              </span>
            </div>
            <ul>
              {rows.map((c) => (
                <li key={c.id} className="border-t border-[var(--line)] first:border-t-0">
                  <LedgerRow c={c} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function LegendItem({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[var(--ink-3)]">
      <span className="h-2 w-2 rounded-[1px]" style={{ background: color }} aria-hidden />
      {label} {n}
    </span>
  );
}

function LedgerRow({ c }: { c: CheckpointResult }) {
  const color = STATUS_COLOR[c.status];
  return (
    <details className="group">
      <summary className="flex min-h-[3rem] items-center gap-3 px-4 py-2.5">
        <StatusMark status={c.status} />
        <span className="min-w-0 flex-1">
          <span className="tnum block text-[0.5625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
            {c.id}
          </span>
          <span className="block text-[0.875rem] font-medium leading-snug">{c.title}</span>
        </span>
        <svg
          className="shrink-0 transition-transform duration-150 group-open:rotate-90"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
        >
          <path
            d="m6 3.5 4.5 4.5L6 12.5"
            stroke="var(--ink-3)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <div className="space-y-2.5 px-4 pb-4 pl-[3.25rem] pt-0.5">
        <LedgerDetail term="Standard" body={c.standard} />
        <LedgerDetail term="If it fails" body={c.longevity} />
        <LedgerDetail term="Evidence" body={c.evidence} />
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span
            className="chip"
            style={{
              color,
              borderColor: `color-mix(in oklab, ${color} 55%, transparent)`,
            }}
          >
            {STATUS_WORD[c.status]}
          </span>
          <span className="chip">{SOURCE_LABEL[c.source]}</span>
          {c.keyframeIndex != null && <span className="chip">frame {c.keyframeIndex + 1}</span>}
        </div>
      </div>
    </details>
  );
}

function LedgerDetail({ term, body }: { term: string; body: string }) {
  return (
    <div>
      <p className="label">{term}</p>
      <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{body}</p>
    </div>
  );
}

function StatusMark({ status }: { status: CheckpointStatus }) {
  const color = STATUS_COLOR[status];
  const common =
    "flex h-[1.375rem] w-[1.375rem] shrink-0 items-center justify-center rounded-[5px]";
  const style = {
    color,
    border: `1.5px solid color-mix(in oklab, ${color} 60%, transparent)`,
    background: `color-mix(in oklab, ${color} 10%, transparent)`,
  };

  return (
    <span className={common} style={style} role="img" aria-label={STATUS_WORD[status]}>
      {status === "pass" && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.5 6.2 4.8 8.6 9.5 3.6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {status === "fail" && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M3.2 3.2l5.6 5.6M8.8 3.2 3.2 8.8"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      )}
      {status === "attention" && (
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M6 1.9 11 10.4H1L6 1.9Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M6 5v2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="6" cy="8.9" r="0.7" fill="currentColor" />
        </svg>
      )}
      {status === "not_assessable" && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 6h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
