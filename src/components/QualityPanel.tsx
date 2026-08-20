import type { Finding, QualityReport } from "@/lib/types";
import { GradeRing } from "./Grade";

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

export default function QualityPanel({ report }: { report: QualityReport }) {
  const caption = report.visionAvailable
    ? `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} across ${report.dimensions.length} scored dimensions.`
    : "Scored on measured geometry only — the visual review did not run, so workmanship and compliance are not included.";

  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <GradeRing score={report.score} grade={report.grade} caption={caption} />
      </div>

      <div className="border-t border-[var(--line)] px-5 py-4">
        <h3 className="label mb-3">How it scored</h3>
        <ul className="space-y-3">
          {report.dimensions.map((d) => (
            <li key={d.dimension}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{DIMENSION_LABEL[d.dimension]}</span>
                <span className="tnum text-sm text-[var(--ink-2)]">
                  {Math.round(d.score)}
                  <span className="text-[var(--ink-3)]"> · {Math.round(d.weight * 100)}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, Math.round(d.score))}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-[var(--ink-3)]">{d.basis}</p>
            </li>
          ))}
        </ul>
      </div>

      {report.findings.length > 0 && (
        <div className="border-t border-[var(--line)] px-5 py-4">
          <h3 className="label mb-3">Findings</h3>
          <ul className="space-y-3">
            {report.findings.map((f) => {
              const s = SEVERITY_STYLE[f.severity];
              return (
                <li key={f.id} className="rounded-xl bg-[var(--surface-2)] p-3.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-white"
                      style={{ background: s.color }}
                    >
                      {s.label}
                    </span>
                    <span className="label">{SOURCE_LABEL[f.source]}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-snug">{f.title}</p>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                    {f.detail}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
