import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { ErrorLine } from "@homefax/ui";
import ProfileCard from "@/components/ProfileCard";
import { respondHireAction } from "@/app/account/actions";
import { orgs, people, properties, records, type Hire } from "@homefax/db";
import { streetOf } from "@/lib/address";
import { kit } from "@/lib/kit";
import { orgContext } from "@/lib/session";

/**
 * The hire board. Everyone who has chosen to be listed, in the same permit-card
 * register as the record itself — an offer is a line of work with a property
 * attached, not a message thread.
 */

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<Hire["status"], string> = {
  offered: "var(--accent)",
  accepted: "var(--grade-a)",
  declined: "var(--grade-f)",
  completed: "var(--ink-3)",
};

const STATUS_WORD: Record<Hire["status"], string> = {
  offered: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  completed: "Completed",
};

export default async function HirePage({ searchParams }: PageProps<"/hire">) {
  const sp = await searchParams;

  const data = await kit.asMe(async (tx, me) => {
    const { orgs: mine, org } = await orgContext(tx, me);
    const myOrgIds = new Set(mine.map((o) => o.id));

    // The board: people who listed themselves, and trade companies that did.
    const people_ = (await people.listPublicProfiles(tx)).filter((p) => p.identityId !== me.identity.id);
    const companies = (await orgs.listPublicOrgs(tx, ["contractor", "inspector"])).filter((o) => !myOrgIds.has(o.id));

    // Properties an offer can name: the ones the reader's company holds.
    const myRecords = org ? await records.listRecordsForOrg(tx, org.id) : [];

    const incoming = await records.listIncomingHires(tx, me.identity.id, [...myOrgIds]);
    const sent = org ? await records.listHiresFromOrg(tx, org.id) : [];

    // Names behind the ids on both lists — row-level security hides what the reader may not see.
    const orgNames = await orgs.getOrgsByIds(tx, [...incoming.map((h) => h.fromOrgId), ...sent.map((h) => h.toOrgId).filter((x): x is string => x != null)]);
    const personNames = await records.namesFor(tx, sent.map((h) => h.toIdentityId).filter((x): x is string => x != null));
    const addresses = new Map<string, string>(myRecords.map((r) => [r.record.id, streetOf(r.property)]));
    for (const id of new Set([...incoming, ...sent].map((h) => h.recordId).filter((x): x is string => x != null))) {
      if (addresses.has(id)) continue;
      const record = await records.getRecord(tx, id);
      const property = record ? await properties.getProperty(tx, record.propertyId) : null;
      if (property) addresses.set(id, streetOf(property));
    }

    return { org, people: people_, companies, myRecords, incoming, sent, orgNames, personNames, addresses };
  });

  const { org, companies, myRecords, incoming, sent, orgNames, personNames, addresses } = data;
  const board = data.people;
  const waiting = incoming.filter((h) => h.status === "offered").length;
  const recordOptions = myRecords.map((r) => ({ id: r.record.id, address: streetOf(r.property) }));

  return (
    <>
      <AppHeader
        nav="hire"
        eyebrow="Trades"
        title="Hire"
        subtitle={org ? `Offers go out from ${org.name}` : "Register a company to send offers of your own"}
        meta={`${board.length + companies.length} listed`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        {waiting > 0 && (
          <Link href="#offers" className="card block px-4 py-3 text-[0.875rem] font-medium" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            {waiting} offer{waiting === 1 ? "" : "s"} waiting on you
          </Link>
        )}

        <section>
          <h2 className="eyebrow">The board</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Everyone who has listed themselves. An offer names the work and, if you have one, the property it is on.
          </p>

          {board.length === 0 && companies.length === 0 ? (
            <p className="label mt-3">No one is listed yet</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {board.map((p) => (
                <ProfileCard
                  key={p.identityId}
                  kind="person"
                  to={`u:${p.identityId}`}
                  name={p.name}
                  handle={`@${p.handle}`}
                  headline={p.headline}
                  bio={p.bio}
                  records={recordOptions}
                  canHire={org != null}
                />
              ))}
              {companies.map((c) => (
                <ProfileCard
                  key={c.id}
                  kind="company"
                  to={`o:${c.id}`}
                  name={c.name}
                  handle={c.slug}
                  headline={c.headline}
                  bio={c.bio}
                  records={recordOptions}
                  canHire={org != null}
                />
              ))}
            </ul>
          )}
        </section>

        <section id="offers" className="scroll-mt-24">
          <h2 className="eyebrow">Offers for you</h2>
          {incoming.length === 0 ? (
            <p className="label mt-2.5">No offers on file</p>
          ) : (
            <ul className="mt-2.5 space-y-3">
              {incoming.map((hire) => {
                const from = orgNames.get(hire.fromOrgId)?.name ?? "A company";
                const address = hire.recordId ? addresses.get(hire.recordId) : undefined;
                return (
                  <li key={hire.id} className="card overflow-hidden">
                    <div className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">{hire.task}</p>
                        <StatusChip status={hire.status} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="chip">From {from}</span>
                        {hire.recordId && <span className="chip">{address ?? "On a property"}</span>}
                      </div>

                      {hire.note && <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{hire.note}</p>}
                    </div>

                    {hire.status === "offered" && (
                      <form action={respondHireAction} className="flex gap-2 border-t border-[var(--line)] px-4 py-3">
                        <input type="hidden" name="hireId" value={hire.id} />
                        <button type="submit" name="decision" value="accept" className="btn btn-primary flex-1">
                          Accept
                        </button>
                        <button type="submit" name="decision" value="decline" className="btn btn-secondary flex-1">
                          Decline
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="eyebrow">Sent</h2>
          {!org ? (
            <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Offers are sent from a company. Register yours on{" "}
              <Link href="/team" className="text-[var(--accent)] underline">
                Team
              </Link>
              .
            </p>
          ) : sent.length === 0 ? (
            <p className="label mt-2.5">Nothing sent yet</p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {sent.map((hire) => {
                const to = hire.toIdentityId
                  ? (personNames.get(hire.toIdentityId) ?? "A person")
                  : (orgNames.get(hire.toOrgId ?? "")?.name ?? "A company");
                const address = hire.recordId ? addresses.get(hire.recordId) : undefined;
                return (
                  <li key={hire.id} className="card px-4 py-3">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">{hire.task}</p>
                      <StatusChip status={hire.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="chip">To {to}</span>
                      {address && <span className="chip">{address}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

function StatusChip({ status }: { status: Hire["status"] }) {
  const c = STATUS_COLOR[status];
  return (
    <span className="chip shrink-0" style={{ borderColor: c, color: c }}>
      {STATUS_WORD[status]}
    </span>
  );
}
