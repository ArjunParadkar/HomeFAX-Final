import { partsSubtotal } from "@/lib/parts";
import type { PartLine } from "@/lib/types";

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

export default function PartsTable({
  parts,
  showTotals = true,
}: {
  parts: PartLine[];
  showTotals?: boolean;
}) {
  if (parts.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-[var(--ink-2)]">
        Nothing taken off yet. Parts appear once a stage has been reconstructed.
      </p>
    );
  }

  const groups = new Map<string, PartLine[]>();
  for (const p of parts) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  const subtotal = partsSubtotal(parts);

  return (
    <div>
      {[...groups.entries()].map(([category, lines]) => (
        <div key={category} className="border-b border-[var(--line)] last:border-b-0">
          <h3 className="label px-5 pb-2 pt-4">{category}</h3>
          <ul>
            {lines.map((p) => (
              <li key={p.id} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium leading-snug">{p.name}</span>
                  <span className="tnum shrink-0 text-sm font-semibold">
                    {p.quantity.toLocaleString()}
                    <span className="ml-1 text-xs font-normal text-[var(--ink-3)]">{p.unit}</span>
                  </span>
                </div>
                {p.spec && <p className="text-xs text-[var(--ink-3)]">{p.spec}</p>}
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: BASIS_COLOR[p.basis] }}
                    aria-hidden
                  />
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
        <div className="flex items-baseline justify-between border-t border-[var(--line)] px-5 py-4">
          <div>
            <span className="text-sm font-semibold">Material subtotal</span>
            <p className="text-[0.6875rem] text-[var(--ink-3)]">
              List prices, no labour, no tax
            </p>
          </div>
          <span className="tnum text-lg font-semibold">
            ${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
    </div>
  );
}
