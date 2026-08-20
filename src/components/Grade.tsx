import type { QualityReport } from "@/lib/types";

const GRADE_VAR: Record<QualityReport["grade"], string> = {
  A: "var(--grade-a)",
  B: "var(--grade-b)",
  C: "var(--grade-c)",
  D: "var(--grade-d)",
  F: "var(--grade-f)",
};

export function GradeBadge({
  grade,
  size = "md",
}: {
  grade: QualityReport["grade"];
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-7 w-7 text-sm" : "h-10 w-10 text-lg";
  return (
    <span
      className={`${dim} tnum inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white`}
      style={{ background: GRADE_VAR[grade] }}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}

/** The headline number on a record: one ring, one letter, no decoration. */
export function GradeRing({
  score,
  grade,
  caption,
}: {
  score: number;
  grade: QualityReport["grade"];
  caption: string;
}) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
          <circle
            cx="56"
            cy="56"
            r={r}
            fill="none"
            stroke="var(--line)"
            strokeWidth="9"
          />
          <circle
            cx="56"
            cy="56"
            r={r}
            fill="none"
            stroke={GRADE_VAR[grade]}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-3xl font-semibold leading-none">{Math.round(score)}</span>
          <span className="label mt-1">grade {grade}</span>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-[var(--ink-2)]">{caption}</p>
    </div>
  );
}
