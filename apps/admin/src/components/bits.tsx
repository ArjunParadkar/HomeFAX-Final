import type { StageGrade } from "@homefax/db";
import { STAGES } from "@homefax/core";
import { oversight } from "@homefax/db";
type RiskBand = oversight.RiskBand;

/** Small shared marks: the 11-tick comb with grade colours, status words, risk bands. */

export const GRADE_VAR: Record<"A" | "B" | "C" | "D" | "F", string> = {
  A: "var(--grade-a)",
  B: "var(--grade-b)",
  C: "var(--grade-c)",
  D: "var(--grade-d)",
  F: "var(--grade-f)",
};

export const RISK_LABEL: Record<RiskBand, string> = {
  low: "Low risk",
  moderate: "Moderate",
  elevated: "Elevated",
  high: "High risk",
  unknown: "Not yet graded",
};

export const RISK_COLOR: Record<RiskBand, string> = {
  low: "var(--grade-a)",
  moderate: "var(--grade-c)",
  elevated: "var(--grade-d)",
  high: "var(--grade-f)",
  unknown: "var(--ink-3)",
};

/** One tick per stage, lit in the grade's colour when it is on file. */
export function Comb({ grades, className = "" }: { grades: Pick<StageGrade, "stage" | "grade">[]; className?: string }) {
  const by = new Map(grades.map((g) => [g.stage, g.grade]));
  return (
    <div className={`comb comb-11 ${className}`} aria-label={`${grades.length} of ${STAGES.length} stages on file`} role="img">
      {STAGES.map((s) => {
        const g = by.get(s.id);
        return <span key={s.id} className="tick" title={`${s.label}${g ? ` · ${g}` : " · not filmed"}`} style={g ? { background: GRADE_VAR[g] } : undefined} />;
      })}
    </div>
  );
}

export function RiskWord({ band }: { band: RiskBand }) {
  return (
    <span className="inline-flex items-center text-[0.8125rem] font-medium" style={{ color: RISK_COLOR[band] }}>
      <span className="status-dot" style={{ background: RISK_COLOR[band] }} aria-hidden />
      {RISK_LABEL[band]}
    </span>
  );
}

/** Verified / flagged / pending in the reserved colours, always with the word. */
export function StatusWord({ tone, children }: { tone: "good" | "bad" | "neutral" | "warn"; children: React.ReactNode }) {
  const color = tone === "good" ? "var(--grade-a)" : tone === "bad" ? "var(--grade-f)" : tone === "warn" ? "var(--grade-c)" : "var(--ink-3)";
  return (
    <span className="inline-flex items-center whitespace-nowrap text-[0.8125rem] font-medium" style={{ color }}>
      <span className="status-dot" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

export function riskOf(stats: Parameters<typeof oversight.riskProfile>[0]) {
  return oversight.riskProfile(stats);
}

export const VERDICT_WORD = { verified: "Verified", flagged: "Flagged", site_visit: "Site visit" } as const;
export const VERDICT_TONE = { verified: "good", flagged: "bad", site_visit: "warn" } as const;

export const DRAW_TONE = { requested: "neutral", verified: "good", released: "good", held: "warn", rejected: "bad" } as const;
export const POLICY_TONE = { quoted: "neutral", bound: "good", active: "good", lapsed: "warn", cancelled: "bad" } as const;
export const LISTING_TONE = { draft: "neutral", active: "good", pending: "warn", sold: "good", withdrawn: "bad" } as const;
export const PERMIT_TONE = { applied: "neutral", issued: "good", inspected: "good", closed: "neutral", flagged: "bad", revoked: "bad" } as const;
export const HOLDING_TONE = { pipeline: "neutral", active: "good", paid_off: "neutral", default: "bad", sold: "neutral" } as const;
export const REQUEST_TONE = { pending: "warn", approved: "good", denied: "bad", withdrawn: "neutral" } as const;
