import Link from "next/link";
import { GradeChip } from "@homefax/ui";
import type { Tick } from "@/lib/house";

/**
 * The sequence of eleven stages as a rail, as on the contractor's record page,
 * each linking to its stage page. The homeowner's status words say what the
 * record holds, not what the crew should do next.
 */

const STATUS_WORD: Record<Tick["state"], string> = {
  graded: "Graded, model on file",
  done: "Model on file",
  working: "Model being built",
  failed: "Reconstruction failed",
  open: "Not filmed yet",
};

export default function StageRail({ ticks, href }: { ticks: Tick[]; href: (stage: Tick["stage"]) => string }) {
  return (
    <ol>
      {ticks.map((t, i) => {
        const filmed = t.state === "graded" || t.state === "done";
        return (
          <li key={t.stage} className="rail relative pb-1.5">
            <Link href={href(t.stage)} className="flex min-h-[3.25rem] items-center gap-3.5 py-2">
              <span
                className="tnum relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold"
                style={{
                  borderColor: filmed ? "transparent" : "var(--line)",
                  background: filmed ? "var(--accent)" : "var(--surface)",
                  color: filmed ? "var(--accent-ink)" : "var(--ink-3)",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-medium leading-snug">{t.label}</span>
                <span className="tnum block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                  {STATUS_WORD[t.state]}
                  {t.score != null ? ` · ${Math.round(t.score)}/100` : ""}
                </span>
              </span>
              {t.grade ? (
                <GradeChip grade={t.grade} size="sm" />
              ) : t.state === "working" ? (
                <span className="pulsing h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
                  <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
