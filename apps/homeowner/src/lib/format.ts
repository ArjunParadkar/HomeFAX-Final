import type { QualityReport } from "@homefax/core";

/**
 * Dates and figures in the record's register. The homeowner reads these on a
 * phone, so dates are short ("12 Sep"), money is whole dollars, and every
 * helper returns a string ready to set in mono.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "12 Sep", with the year once it is not this year. */
export function formatDay(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "today", "yesterday", "last Tue", "12 Sep" — for the access log. */
export function formatWhen(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  const now = new Date();
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `last ${DAYS[d.getDay()]}`;
  return formatDay(d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "$12,480" from cents. */
export function formatMoneyCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const GRADE_VAR: Record<QualityReport["grade"], string> = {
  A: "var(--grade-a)",
  B: "var(--grade-b)",
  C: "var(--grade-c)",
  D: "var(--grade-d)",
  F: "var(--grade-f)",
};

/** The grade word, in the second person — what it means for the house. */
const GRADE_READING: Record<QualityReport["grade"], string> = {
  A: "was built to standard",
  B: "is sound, with minor notes",
  C: "has correctable defects on record",
  D: "needs rework before it is covered",
  F: "did not meet the standard",
};

/**
 * One sentence under a grade stamp: "Your framing scored 86 of 100 and is
 * sound, with minor notes — 38 of 41 assessed points passed."
 */
export function gradeReading(
  stageLabel: string,
  grade: QualityReport["grade"],
  score: number,
  tally?: { passed: number; assessed: number } | null,
): string {
  // Lower-case the label as a phrase, but leave acronyms (HVAC) alone.
  const subject = stageLabel
    .split(" ")
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase()))
    .join(" ");
  const head = `Your ${subject} scored ${Math.round(score)} of 100 and ${GRADE_READING[grade]}`;
  if (tally && tally.assessed > 0) {
    return `${head} — ${tally.passed} of ${tally.assessed} assessed points passed.`;
  }
  return `${head}.`;
}
