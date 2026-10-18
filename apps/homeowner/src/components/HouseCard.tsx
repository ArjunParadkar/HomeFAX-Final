import Link from "next/link";
import { GRADE_VAR } from "@/lib/format";
import type { Tick } from "@/lib/house";

/**
 * The house card — the signature element of the homeowner app.
 *
 * The address set large, the eleven-tick comb underneath as the primary
 * navigation (every tick is a link to its stage; graded ticks carry the grade
 * colour, filmed-but-ungraded ticks the accent, open ticks are hollow), and
 * one mono line beneath that says where the build stands. The same card draws
 * on paper (the owner's pages) and on the onyx plate (the landing, the public
 * report) — the tokens do the work.
 *
 * Nested anchors are invalid HTML, so when the whole card should open the
 * house, only the address is the link; the ticks stay their own links.
 */

export default function HouseCard({
  address,
  place,
  standing,
  ticks,
  tickHref,
  addressHref,
  surface = "paper",
  eyebrow,
}: {
  address: string;
  /** "Bentonville, AR 72712" */
  place?: string;
  /** "7 of 11 stages on file · last filmed 12 Sep" */
  standing: string;
  ticks: Tick[];
  /** Where a tick goes. Omit to draw the comb without links. */
  tickHref?: (stage: Tick["stage"]) => string;
  /** When set, the address itself opens the house. */
  addressHref?: string;
  surface?: "paper" | "plate";
  eyebrow?: string;
}) {
  const panel = surface === "plate" ? "plate" : "card";
  const graded = ticks.filter((t) => t.state === "graded").length;

  return (
    <section className={`${panel} overflow-hidden`}>
      <div className="px-4 pb-3 pt-4">
        {(eyebrow || place) && <p className="eyebrow">{eyebrow ?? place}</p>}
        {addressHref ? (
          <Link
            href={addressHref}
            className="mt-1.5 block text-[1.5rem] font-semibold leading-[1.15] tracking-[-0.02em]"
          >
            {address}
          </Link>
        ) : (
          <h2 className="mt-1.5 text-[1.5rem] font-semibold leading-[1.15] tracking-[-0.02em]">
            {address}
          </h2>
        )}
        {eyebrow && place && (
          <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">{place}</p>
        )}
      </div>

      <nav aria-label={`Stages of ${address}`} className="px-4">
        <ol className="comb comb-11">
          {ticks.map((t, i) => {
            const label = tickLabel(t, i);
            const style = tickStyle(t);
            const inner = (
              <span className="tick block w-full" style={style} aria-hidden />
            );
            return (
              <li key={t.stage} className="min-w-0">
                {tickHref ? (
                  <Link
                    href={tickHref(t.stage)}
                    aria-label={label}
                    title={label}
                    className="flex min-h-[2.75rem] items-end rounded-[4px] pb-1"
                  >
                    {inner}
                  </Link>
                ) : (
                  <span className="flex min-h-[1.75rem] items-end pb-1" title={label} aria-label={label} role="img">
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <p className="tnum px-4 pb-4 pt-2 text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
        {standing}
        {graded > 0 && ticks.some((t) => t.state === "graded") && (
          <span className="sr-only">. {graded} graded.</span>
        )}
      </p>
    </section>
  );
}

function tickLabel(t: Tick, i: number): string {
  const n = String(i + 1).padStart(2, "0");
  switch (t.state) {
    case "graded":
      return `${n} ${t.label} — graded ${t.grade}`;
    case "done":
      return `${n} ${t.label} — on file, not graded`;
    case "working":
      return `${n} ${t.label} — model being built`;
    case "failed":
      return `${n} ${t.label} — reconstruction failed`;
    default:
      return `${n} ${t.label} — not filmed yet`;
  }
}

function tickStyle(t: Tick): React.CSSProperties {
  switch (t.state) {
    case "graded":
      return { background: GRADE_VAR[t.grade ?? "C"] };
    case "done":
      return { background: "var(--accent)" };
    case "working":
      return { background: "color-mix(in oklab, var(--accent) 40%, transparent)" };
    case "failed":
      return { background: "transparent", boxShadow: "inset 0 0 0 1px var(--grade-f)" };
    default:
      // Hollow: the open stages are an outline, not a dim fill.
      return { background: "transparent", boxShadow: "inset 0 0 0 1px var(--line)" };
  }
}
