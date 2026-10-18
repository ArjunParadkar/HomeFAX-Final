import { notFound } from "next/navigation";
import { properties } from "@homefax/db";
import AppHeader from "@/components/AppHeader";
import Timeline from "@/components/Timeline";
import { formatDay, plural } from "@/lib/format";
import { addressLine, openHouse } from "@/lib/house";
import { kit } from "@/lib/kit";

/**
 * The whole story, and who owned the house when. Ownership periods stay on
 * the record even after an owner erases their account — the house outlives
 * everyone who holds it.
 */

export const dynamic = "force-dynamic";

export default async function HistoryPage({ params }: PageProps<"/home/[slug]/history">) {
  const { slug } = await params;

  const data = await kit.asMe(async (tx, me) => {
    const house = await openHouse(tx, me.identity.id, slug, `/home/${slug}/history`);
    if (!house) return null;
    const [events, owners] = await Promise.all([properties.listEvents(tx, house.property.id, 500), properties.listOwners(tx, house.property.id, true)]);
    return { house, events, owners, me };
  });
  if (!data) notFound();

  const { house, events, owners, me } = data;
  const p = house.property;

  return (
    <>
      <AppHeader
        back={{ href: `/home/${slug}`, label: addressLine(p) }}
        eyebrow="History"
        title="Everything on the record"
        subtitle={`${plural(events.length, "entry", "entries")} since the record was opened${p.yearBuilt ? ` · built ${p.yearBuilt}` : ""}`}
        meta={formatDay(p.createdAt)}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Who owned it when</h2>
          </div>
          {owners.length === 0 ? (
            <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">No owner is on record.</p>
          ) : (
            <ol>
              {owners.map(({ owner, profile }) => (
                <li key={owner.id} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-medium leading-snug">
                      {profile.name}
                      {profile.identityId === me.identity.id ? " (you)" : ""}
                    </span>
                    <span className="tnum mt-0.5 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      {formatDay(owner.since)} → {owner.until ? formatDay(owner.until) : "now"}
                    </span>
                  </span>
                  <span className={`chip shrink-0 ${owner.until ? "" : "chip-accent"}`}>{owner.until ? "Past" : owner.role.replace("_", "-")}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="border-t border-[var(--line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
            Ownership periods stay on the record for the life of the house, even after an owner closes their account.
          </p>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">The timeline</h2>
          </div>
          <Timeline events={events} stageHref={(stage) => `/home/${slug}/stages/${stage}`} />
        </section>
      </main>
    </>
  );
}
