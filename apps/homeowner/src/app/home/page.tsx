import Link from "next/link";
import { redirect } from "next/navigation";
import { access, orgs, properties } from "@homefax/db";
import { ErrorLine } from "@homefax/ui";
import AppHeader from "@/components/AppHeader";
import HouseCard from "@/components/HouseCard";
import { addressLine, placeLine, standingLine, ticksForOwner } from "@/lib/house";
import { kit } from "@/lib/kit";

/**
 * Your homes. Most people have one, so with exactly one house this page is a
 * doorway and sends them straight to it. With several, one house card each,
 * and a banner for anything an institution is asking for.
 */

export const dynamic = "force-dynamic";

export default async function HomesPage({ searchParams }: PageProps<"/home">) {
  const sp = await searchParams;

  const data = await kit.asMe(async (tx, me) => {
    const houses = await properties.listPropertiesForOwner(tx, me.identity.id);
    const pending = await access.listPendingRequestsForOwner(tx, me.identity.id);
    const orgNames = await orgs.getOrgsByIds(tx, pending.map((p) => p.request.requesterOrgId));
    const ticks = await Promise.all(houses.map((h) => ticksForOwner(tx, h.property.id)));
    return { me, houses, pending, orgNames, ticks };
  });

  if (data.houses.length === 1 && !sp.error) redirect(`/home/${data.houses[0].property.slug}`);

  const { houses, pending, orgNames } = data;

  return (
    <>
      <AppHeader
        nav="home"
        eyebrow="Your record"
        title="Your homes"
        subtitle={data.me.profile.name}
        meta={`${houses.length} house${houses.length === 1 ? "" : "s"}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        {pending.length > 0 && (
          <section className="card overflow-hidden" style={{ borderColor: "var(--accent)" }}>
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h2 className="eyebrow" style={{ color: "var(--accent)" }}>
                Asking to see your record
              </h2>
            </div>
            <ul>
              {pending.map(({ request, property }) => (
                <li key={request.id} className="border-b border-[var(--line)] last:border-b-0">
                  <Link href={`/home/${property.slug}/access`} className="flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-medium leading-snug">
                        {orgNames.get(request.requesterOrgId)?.name ?? "An organisation"} is asking to see {addressLine(property)}
                      </span>
                      <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{request.purpose}</span>
                    </span>
                    <span className="chip chip-accent shrink-0">{access.SCOPE_LABEL[request.scope]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {houses.length === 0 ? (
          <section className="card px-4 py-5">
            <p className="label">No homes on your record yet</p>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              A house joins your record with the claim code your builder prints from theirs. When you have it, the house, its models, its grades and everything in its walls arrive at once.
            </p>
            <Link href="/claim" className="btn btn-primary mt-4 w-full">
              Enter a claim code
            </Link>
          </section>
        ) : (
          <section className="space-y-4">
            {houses.map(({ property, stats }, i) => (
              <HouseCard
                key={property.id}
                address={addressLine(property)}
                place={placeLine(property)}
                standing={standingLine(stats)}
                ticks={data.ticks[i]}
                addressHref={`/home/${property.slug}`}
                tickHref={(stage) => `/home/${property.slug}/stages/${stage}`}
              />
            ))}
          </section>
        )}

        {houses.length > 0 && (
          <Link href="/claim" className="card flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 text-[0.875rem] font-medium">Add another house with a claim code</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
              <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}

        <p className="eyebrow text-center">Each tick is a stage · tap one to open it</p>
      </main>
    </>
  );
}
