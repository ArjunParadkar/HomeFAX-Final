import { notFound } from "next/navigation";
import { isStageId, stageDef } from "@homefax/core";
import { records } from "@homefax/db";
import { PartsTable } from "@homefax/ui";
import AppHeader from "@/components/AppHeader";
import { formatMoneyCents, plural } from "@/lib/format";
import { addressLine, openHouse, toPartLines } from "@/lib/house";
import { kit } from "@/lib/kit";

/**
 * What is in your walls. Every material line across every stage, grouped the
 * way a supplier would group them, with the exact identifications called out
 * on their own — those are the lines you will need five years from now.
 */

export const dynamic = "force-dynamic";

export default async function MaterialsPage({ params }: PageProps<"/home/[slug]/materials">) {
  const { slug } = await params;

  const data = await kit.asMe(async (tx, me) => {
    const house = await openHouse(tx, me.identity.id, slug, `/home/${slug}/materials`);
    if (!house) return null;
    const rows = await records.listPartLines(tx, house.property.id);
    return { house, parts: toPartLines(rows) };
  });
  if (!data) notFound();

  const { house, parts } = data;
  const stages = new Set(parts.map((p) => p.stage));
  const identified = parts.filter((p) => p.identified && (p.identified.manufacturer || p.identified.model || p.identified.color || p.identified.finish || p.identified.size));

  return (
    <>
      <AppHeader
        back={{ href: `/home/${slug}`, label: addressLine(house.property) }}
        eyebrow="Materials on record"
        title="What is in your walls"
        subtitle="Every material your builder's models and footage accounted for, stage by stage, at list prices."
        meta={plural(parts.length, "line")}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <section className="card overflow-hidden">
          <dl className="rule-grid grid-cols-3 border-t-0">
            <div className="field">
              <dt>Lines</dt>
              <dd>{parts.length}</dd>
            </div>
            <div className="field">
              <dt>Stages</dt>
              <dd>{stages.size}</dd>
            </div>
            <div className="field">
              <dt>Total</dt>
              <dd>{formatMoneyCents(house.stats.materialsTotalCents)}</dd>
            </div>
          </dl>
          <p className="border-t border-[var(--line)] px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {parts.length === 0
              ? "No materials are on record yet. They appear as each stage is filmed and measured."
              : `${formatMoneyCents(house.stats.materialsTotalCents)} of materials across ${plural(stages.size, "stage")}, at list prices with no labour or tax. Quantities are measured off the models or counted in the footage — each line says which.`}
          </p>
        </section>

        {identified.length > 0 && (
          <section className="card overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
              <h2 className="eyebrow">Read off a label</h2>
              <span className="tnum text-[0.625rem] text-[var(--ink-3)]">{identified.length}</span>
            </div>
            <ul>
              {identified.map((p) => {
                const id = p.identified!;
                const make = [id.manufacturer, id.model].filter(Boolean).join(" ");
                const spec = [id.color, id.finish, id.size].filter(Boolean).join(" · ");
                return (
                  <li key={p.id} className="border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                    <p className="tnum text-[0.8125rem] font-medium uppercase tracking-[0.04em]">{make || p.name}</p>
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                      {p.name}
                      {spec ? ` · ${spec}` : ""}
                      {id.readFrom ? ` — read off the ${id.readFrom}` : ""}
                    </p>
                    <span className="chip mt-1.5">{isStageId(p.stage) ? stageDef(p.stage).short : p.stage}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <PartsTable
          parts={parts}
          title="Every line, by category"
          note={parts.length > 0 ? `${plural(identified.length, "line carries", "lines carry")} an exact make and model read off a label in the footage. Everything else is a measured or counted quantity with its derivation.` : undefined}
        />
      </main>
    </>
  );
}
