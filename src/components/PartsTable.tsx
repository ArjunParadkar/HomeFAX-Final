import { partsSubtotal } from "@/lib/parts";
import type { PartLine } from "@/lib/types";

/**
 * The takeoff. Every line shows where its number came from, because a quantity
 * without a derivation is a guess with a decimal point. Lines the review could
 * read a label off carry the exact make and model — that is what a homeowner
 * needs five years later when a fixture has to be matched.
 */

const BASIS_NOTE: Record<PartLine["basis"], string> = {
  measured: "measured off the model",
  detected: "counted in the footage",
  derived: "implied by a measured quantity",
};

const BASIS_COLOR: Record<PartLine["basis"], string> = {
  measured: "var(--grade-a)",
  detected: "var(--accent)",
  derived: "var(--ink-3)",
};

const CATEGORY_LABEL: Record<string, string> = {
  lumber: "Lumber",
  concrete: "Concrete",
  fastener: "Fasteners",
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  insulation: "Insulation",
  drywall: "Drywall",
  roofing: "Roofing",
  finish: "Finishes",
  fixture: "Fixtures",
  hardware: "Hardware",
};

export default function PartsTable({
  parts,
  showTotals = true,
  title = "Materials on this stage",
  note,
}: {
  parts: PartLine[];
  showTotals?: boolean;
  title?: string;
  /** One line under the heading, e.g. what "cumulative" means on a record. */
  note?: string;
}) {
  if (parts.length === 0) {
    return (
      <section className="card p-4">
        <h3 className="eyebrow">{title}</h3>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          Nothing taken off yet. Film the stage and the parts list builds itself from the model.
        </p>
      </section>
    );
  }

  const groups = new Map<string, PartLine[]>();
  for (const p of parts) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  const subtotal = partsSubtotal(parts);
  const identifiedCount = parts.filter((p) => hasId(p)).length;

  return (
    <section className="card overflow-hidden">
      <header className="px-4 pb-3 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="eyebrow">{title}</h3>
          <span className="tnum text-[0.625rem] text-[var(--ink-3)]">
            {parts.length} line{parts.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          {note ??
            (identifiedCount > 0
              ? `${identifiedCount} line${identifiedCount === 1 ? " carries" : "s carry"} an exact make and model read off a label in the footage.`
              : "Every quantity carries the derivation it came from.")}
        </p>
      </header>

      {[...groups.entries()].map(([category, lines]) => (
        <div key={category} className="border-t border-[var(--line)]">
          <div className="flex items-baseline justify-between gap-3 bg-[var(--surface-2)] px-4 py-2">
            <h4 className="label">{CATEGORY_LABEL[category] ?? category}</h4>
            <span className="tnum text-[0.625rem] text-[var(--ink-3)]">{lines.length}</span>
          </div>
          <ul>
            {lines.map((p) => (
              <li key={p.id} className="border-t border-[var(--line)] px-4 py-3.5 first:border-t-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[0.9375rem] font-medium leading-snug">{p.name}</span>
                  <span className="shrink-0 text-right">
                    <span className="tnum block text-[0.9375rem] font-semibold">
                      {p.quantity.toLocaleString()}
                      <span className="ml-1 text-[0.6875rem] font-normal text-[var(--ink-3)]">
                        {p.unit}
                      </span>
                    </span>
                    {p.unitCostUsd != null && (
                      <span className="tnum block text-[0.625rem] text-[var(--ink-3)]">
                        ${Math.round(p.unitCostUsd * p.quantity).toLocaleString()}
                      </span>
                    )}
                  </span>
                </div>

                {p.spec && (
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                    {p.spec}
                  </p>
                )}

                {hasId(p) && <ExactId part={p} />}

                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: BASIS_COLOR[p.basis] }}
                      aria-hidden
                    />
                    <span className="tnum text-[0.625rem] uppercase tracking-[0.1em] text-[var(--ink-3)]">
                      {p.basis}
                    </span>
                  </span>
                  <span className="text-[0.6875rem] text-[var(--ink-3)]">
                    {BASIS_NOTE[p.basis]} · {Math.round(p.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">
                  {p.derivation}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {showTotals && subtotal > 0 && (
        <div className="flex items-baseline justify-between gap-3 border-t border-[var(--line)] px-4 py-4">
          <div>
            <span className="text-[0.875rem] font-semibold">Material subtotal</span>
            <p className="text-[0.6875rem] text-[var(--ink-3)]">List prices, no labour, no tax</p>
          </div>
          <span className="tnum text-lg font-semibold">
            ${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
    </section>
  );
}

function hasId(p: PartLine): boolean {
  const id = p.identified;
  if (!id) return false;
  return Boolean(id.manufacturer || id.model || id.color || id.finish || id.size);
}

/**
 * The exact-ID plate. Set apart from the estimate around it: this is the one
 * part of a line that was read, not computed.
 */
function ExactId({ part }: { part: PartLine }) {
  const id = part.identified!;
  const make = [id.manufacturer, id.model].filter(Boolean).join(" · ");
  const spec = [id.color, id.finish, id.size].filter(Boolean).join(" · ");

  return (
    <div
      className="sheet mt-2 px-3 py-2"
      style={{
        borderLeft: "2px solid var(--accent)",
        borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
      }}
    >
      <span className="chip chip-accent">Exact ID</span>
      {make && (
        <p className="tnum mt-1.5 text-[0.75rem] font-medium uppercase leading-snug tracking-[0.04em]">
          {make}
        </p>
      )}
      {spec && (
        <p className="tnum mt-0.5 text-[0.6875rem] uppercase leading-snug tracking-[0.04em] text-[var(--ink-2)]">
          {spec}
        </p>
      )}
      {id.readFrom && (
        <p className="mt-1 text-[0.625rem] leading-relaxed text-[var(--ink-3)]">
          Read from {id.readFrom}
        </p>
      )}
    </div>
  );
}
