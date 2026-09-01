import type { QualityReport } from "@/lib/types";

/**
 * The grade, as a stamp.
 *
 * Every stud in a framed wall carries an ink grade stamp: the mill, the grade,
 * the species, the moisture content, boxed and dead straight. HomeFAX puts the
 * same mark on the stage. This is the one bold object in the app — everything
 * around it stays flat and quiet.
 */

const GRADE_VAR: Record<QualityReport["grade"], string> = {
  A: "var(--grade-a)",
  B: "var(--grade-b)",
  C: "var(--grade-c)",
  D: "var(--grade-d)",
  F: "var(--grade-f)",
};

const GRADE_WORD: Record<QualityReport["grade"], string> = {
  A: "Built to standard",
  B: "Sound, minor notes",
  C: "Correctable defects",
  D: "Rework advised",
  F: "Not acceptable",
};

/** Small mark for lists and rails, where the grade is a data point not a headline. */
export function GradeChip({
  grade,
  size = "md",
}: {
  grade: QualityReport["grade"];
  size?: "sm" | "md";
}) {
  const c = GRADE_VAR[grade];
  const dim = size === "sm" ? "h-6 w-6 text-[0.75rem]" : "h-8 w-8 text-base";
  return (
    <span
      className={`${dim} inline-flex shrink-0 items-center justify-center rounded-[5px] font-bold`}
      style={{
        color: c,
        border: `1.5px solid ${c}`,
        background: `color-mix(in oklab, ${c} 12%, transparent)`,
        letterSpacing: "-0.02em",
      }}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}

export function GradeStamp({
  score,
  grade,
  stageLabel,
  caption,
  tally,
}: {
  score: number;
  grade: QualityReport["grade"];
  /** What was assessed, printed in the stamp head. */
  stageLabel: string;
  /** One line under the figure explaining what the number rests on. */
  caption: string;
  /** Optional ledger tally, e.g. "38 of 41 points passed". */
  tally?: string;
}) {
  const c = GRADE_VAR[grade];
  const rounded = Math.round(score);

  return (
    <figure
      className="overflow-hidden rounded-[var(--radius)]"
      style={{ border: `2px solid ${c}`, background: "var(--surface)" }}
      aria-label={`Grade ${grade}. Score ${rounded} out of 100.`}
    >
      <div
        className="flex items-center justify-between gap-3 px-3.5 py-2"
        style={{
          background: `color-mix(in oklab, ${c} 12%, transparent)`,
          borderBottom: `1px solid color-mix(in oklab, ${c} 45%, transparent)`,
        }}
      >
        <span
          className="tnum text-[0.5625rem] font-semibold uppercase"
          style={{ letterSpacing: "0.2em", color: c }}
        >
          HomeFAX assessed
        </span>
        <span
          className="tnum truncate text-[0.5625rem] font-medium uppercase"
          style={{ letterSpacing: "0.16em", color: "var(--ink-2)" }}
        >
          {stageLabel}
        </span>
      </div>

      <div className="flex items-stretch gap-4 p-4">
        <div
          className="flex h-[4.75rem] w-[4.75rem] shrink-0 flex-col items-center justify-center rounded-[10px]"
          style={{
            border: `2px solid ${c}`,
            background: `color-mix(in oklab, ${c} 10%, transparent)`,
          }}
        >
          <span
            aria-hidden
            className="text-[2.75rem] font-bold leading-none"
            style={{ color: c, letterSpacing: "-0.04em" }}
          >
            {grade}
          </span>
          <span
            className="tnum mt-1 text-[0.5rem] font-medium uppercase"
            style={{ letterSpacing: "0.14em", color: c }}
          >
            grade
          </span>
        </div>

        <div className="flex min-w-0 flex-col justify-center">
          <p className="tnum text-2xl font-semibold leading-none">
            {rounded}
            <span className="text-base font-normal text-[var(--ink-3)]">/100</span>
          </p>
          <p className="mt-1 text-[0.8125rem] font-medium leading-snug">{GRADE_WORD[grade]}</p>
          {tally && (
            <p
              className="tnum mt-1.5 text-[0.625rem] uppercase"
              style={{ letterSpacing: "0.1em", color: "var(--ink-3)" }}
            >
              {tally}
            </p>
          )}
        </div>
      </div>

      <figcaption className="border-t border-[var(--line)] px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
        {caption}
      </figcaption>
    </figure>
  );
}
