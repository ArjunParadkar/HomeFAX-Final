import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ErrorLine from "@/components/ErrorLine";
import ProfileCard from "@/components/ProfileCard";
import { respondHireAction } from "@/app/account/actions";
import {
  activeOrg,
  currentUser,
  getOrg,
  getUser,
  listHiresFromOrg,
  listIncomingHires,
  listOrgsForUser,
  listPublicProfiles,
  type Hire,
} from "@/lib/accounts";
import { listRecordsForOrg, type RecordRow } from "@/lib/store";

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

export default async function HirePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const sp = await searchParams;
  const orgs = await listOrgsForUser(user.id);
  const org = await activeOrg(user.id);
  const myOrgIds = new Set(orgs.map((o) => o.id));

  const board = await listPublicProfiles();
  const people = board.users.filter((u) => u.id !== user.id);
  const companies = board.orgs.filter((o) => !myOrgIds.has(o.id));

  // Properties an offer can name: the ones the reader's company holds.
  const perOrg = await Promise.all(orgs.map((o) => listRecordsForOrg(o.id)));
  const visible = new Map<string, RecordRow>();
  for (const rows of perOrg) for (const r of rows) visible.set(r.id, r);
  const records = org ? (perOrg[orgs.findIndex((o) => o.id === org.id)] ?? []) : [];

  const incoming = await listIncomingHires(user.id);
  const incomingRows = await Promise.all(
    incoming.map(async (h) => ({ hire: h, from: (await getOrg(h.fromOrgId))?.name ?? "A company" })),
  );
  const waiting = incoming.filter((h) => h.status === "offered").length;

  const sent = org ? await listHiresFromOrg(org.id) : [];
  const sentRows = await Promise.all(
    sent.map(async (h) => ({
      hire: h,
      to: h.toUserId
        ? ((await getUser(h.toUserId))?.name ?? "A person")
        : ((await getOrg(h.toOrgId ?? ""))?.name ?? "A company"),
    })),
  );

  return (
    <>
      <AppHeader
        nav="hire"
        eyebrow="Trades"
        title="Hire"
        subtitle={
          org ? `Offers go out from ${org.name}` : "Register a company to send offers of your own"
        }
        meta={`${people.length + companies.length} listed`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        {waiting > 0 && (
          <Link
            href="#offers"
            className="card block px-4 py-3 text-[0.875rem] font-medium"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            {waiting} offer{waiting === 1 ? "" : "s"} waiting on you
          </Link>
        )}

        <section>
          <h2 className="eyebrow">The board</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Everyone who has listed themselves. An offer names the work and, if you have one, the
            property it is on.
          </p>

          {people.length === 0 && companies.length === 0 ? (
            <p className="label mt-3">No one is listed yet</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {people.map((p) => (
                <ProfileCard
                  key={p.id}
                  kind="person"
                  to={`u:${p.id}`}
                  name={p.name}
                  handle={`@${p.handle}`}
                  headline={p.headline}
                  bio={p.bio}
                  records={records.map((r) => ({ id: r.id, address: r.address }))}
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
                  records={records.map((r) => ({ id: r.id, address: r.address }))}
                  canHire={org != null}
                />
              ))}
            </ul>
          )}
        </section>

        <section id="offers" className="scroll-mt-24">
          <h2 className="eyebrow">Offers for you</h2>
          {incomingRows.length === 0 ? (
            <p className="label mt-2.5">No offers on file</p>
          ) : (
            <ul className="mt-2.5 space-y-3">
              {incomingRows.map(({ hire, from }) => {
                const record = hire.recordId ? visible.get(hire.recordId) : undefined;
                return (
                  <li key={hire.id} className="card overflow-hidden">
                    <div className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">
                          {hire.task}
                        </p>
                        <StatusChip status={hire.status} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="chip">From {from}</span>
                        {hire.recordId && (
                          <span className="chip">{record ? record.address : "On a property"}</span>
                        )}
                      </div>

                      {hire.note && (
                        <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                          {hire.note}
                        </p>
                      )}
                    </div>

                    {hire.status === "offered" && (
                      <form
                        action={respondHireAction}
                        className="flex gap-2 border-t border-[var(--line)] px-4 py-3"
                      >
                        <input type="hidden" name="hireId" value={hire.id} />
                        <button
                          type="submit"
                          name="decision"
                          value="accept"
                          className="btn btn-primary flex-1"
                        >
                          Accept
                        </button>
                        <button
                          type="submit"
                          name="decision"
                          value="decline"
                          className="btn btn-secondary flex-1"
                        >
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
          ) : sentRows.length === 0 ? (
            <p className="label mt-2.5">Nothing sent yet</p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {sentRows.map(({ hire, to }) => {
                const record = hire.recordId ? visible.get(hire.recordId) : undefined;
                return (
                  <li key={hire.id} className="card px-4 py-3">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">
                        {hire.task}
                      </p>
                      <StatusChip status={hire.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="chip">To {to}</span>
                      {record && <span className="chip">{record.address}</span>}
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
