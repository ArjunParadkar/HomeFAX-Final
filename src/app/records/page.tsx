import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ErrorLine from "@/components/ErrorLine";
import StatStrip from "@/components/StatStrip";
import { createCompanyAction, setActiveOrgAction } from "@/app/account/actions";
import {
  activeOrg,
  currentUser,
  listAssignmentsForOrg,
  listAssignmentsForUser,
  listOrgsForUser,
  type Assignment,
} from "@/lib/accounts";
import { STAGES, stageDef } from "@/lib/stages";
import { getRecordById, listCaptures, listRecordsForOrg, type RecordRow } from "@/lib/store";
import { createRecordAction } from "./actions";

/**
 * On file — the home tab. What this company has recorded, what the reader
 * personally owes someone this week, and the one form that opens a new record.
 *
 * The strip at the top counts things that exist, not things that were
 * computed: properties, stages filmed, ledger points passed, open tasks.
 */

export const dynamic = "force-dynamic";

const IN_FLIGHT = new Set([
  "queued",
  "extracting",
  "registering",
  "reconstructing",
  "meshing",
  "analyzing",
]);

type TickState = "done" | "working" | "open";

const TICK_COLOR: Record<TickState, string | undefined> = {
  done: "var(--accent)",
  working: "color-mix(in oklab, var(--accent) 40%, transparent)",
  open: undefined,
};

export default async function RecordsPage({ searchParams }: PageProps<"/records">) {
  const user = await currentUser();
  if (!user) redirect("/");

  const sp = await searchParams;
  const orgs = await listOrgsForUser(user.id);
  const org = await activeOrg(user.id);

  // Every record the reader can reach, from every company they belong to. The
  // list below shows the active company's; the map is what lets an assignment
  // name its property instead of showing an id.
  const perOrg = await Promise.all(orgs.map((o) => listRecordsForOrg(o.id)));
  const visible = new Map<string, RecordRow>();
  for (const rows of perOrg) for (const r of rows) visible.set(r.id, r);

  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));
  const records = org ? (perOrg[orgs.findIndex((o) => o.id === org.id)] ?? []) : [];

  const summaries = await Promise.all(
    records.map(async (r) => {
      const captures = await listCaptures(r.id);
      const byStage = new Map(captures.map((c) => [c.stage, c.state]));
      const ticks: TickState[] = STAGES.map((s) => {
        const state = byStage.get(s.id);
        if (state === "done") return "done";
        if (state != null && IN_FLIGHT.has(state)) return "working";
        return "open";
      });

      let passed = 0;
      let assessed = 0;
      for (const c of captures) {
        const q = c.quality;
        if (!q?.checkpoints?.length) continue;
        passed += q.checkpointsPassed ?? q.checkpoints.filter((p) => p.status === "pass").length;
        assessed +=
          q.checkpointsAssessed ??
          q.checkpoints.filter((p) => p.status !== "not_assessable").length;
      }

      return {
        record: r,
        done: ticks.filter((t) => t === "done").length,
        working: ticks.filter((t) => t === "working").length,
        ticks,
        passed,
        assessed,
      };
    }),
  );

  const filmed = summaries.reduce((n, s) => n + s.done, 0);
  const passed = summaries.reduce((n, s) => n + s.passed, 0);
  const assessed = summaries.reduce((n, s) => n + s.assessed, 0);

  // Direct assignments plus everything landed on a company the reader is in.
  const direct = await listAssignmentsForUser(user.id);
  const viaOrgs = (await Promise.all(orgs.map((o) => listAssignmentsForOrg(o.id)))).flat();
  const byId = new Map<string, Assignment>();
  for (const a of [...direct, ...viaOrgs]) byId.set(a.id, a);
  const assignments = [...byId.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const openCount = assignments.filter((a) => a.status === "open").length;

  // A task handed straight to this person can sit on a property their company
  // does not hold — being assigned is itself the access, so the address is
  // theirs to see. Anything still unresolved stays unnamed rather than guessed.
  const unnamed = [...new Set(assignments.map((a) => a.recordId))].filter((id) => !visible.has(id));
  for (const r of await Promise.all(unnamed.map((id) => getRecordById(id)))) {
    if (r) visible.set(r.id, r);
  }

  return (
    <>
      <AppHeader
        nav="records"
        eyebrow="Build records"
        title="On file"
        subtitle={org ? org.name : "No company yet"}
        meta={`${records.length} home${records.length === 1 ? "" : "s"}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        {orgs.length > 1 && (
          <section>
            <h2 className="eyebrow">Filing as</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {orgs.map((o) => {
                const active = o.id === org?.id;
                return (
                  <li key={o.id}>
                    <form action={setActiveOrgAction}>
                      <input type="hidden" name="orgId" value={o.id} />
                      <button
                        type="submit"
                        aria-current={active ? "true" : undefined}
                        className={`chip min-h-[2.75rem] px-3 ${active ? "chip-accent" : ""}`}
                      >
                        {o.name}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {org ? (
          <section className="card overflow-hidden">
            <StatStrip
              className="border-t-0"
              items={[
                { term: "Properties on file", value: String(records.length) },
                { term: "Stages filmed", value: String(filmed) },
                {
                  term: "Points passed",
                  value: assessed > 0 ? `${passed} / ${assessed}` : "—",
                },
                { term: "Open assignments", value: String(openCount) },
              ]}
            />
          </section>
        ) : (
          <section className="card overflow-hidden">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h2 className="eyebrow">Register your company</h2>
            </div>
            <p className="px-4 pt-3.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Records are filed to a company, not a person — so the crew that films a stage still
              has it after you move on. Register yours to open the first record.
            </p>
            <form action={createCompanyAction} className="space-y-4 px-4 pb-4 pt-3.5">
              <div>
                <label className="label block" htmlFor="company-name">
                  Company name
                </label>
                <input
                  id="company-name"
                  name="name"
                  required
                  placeholder="Reyes Framing"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="company-headline">
                  What you do <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="company-headline"
                  name="headline"
                  placeholder="Framing and structural repair, Bentonville"
                  className="input mt-1.5"
                />
              </div>
              <button type="submit" className="btn btn-primary w-full">
                Register company
              </button>
            </form>
          </section>
        )}

        <section>
          <h2 className="eyebrow">Assigned to you</h2>
          {assignments.length === 0 ? (
            <p className="label mt-2.5">Nothing assigned to you</p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {assignments.map((a) => {
                const record = visible.get(a.recordId);
                const forWhom =
                  a.assigneeUserId === user.id
                    ? "You"
                    : (orgNames.get(a.assigneeOrgId ?? "") ?? "Your company");
                return (
                  <li key={a.id} className="card px-4 py-3">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">
                        {a.task}
                      </p>
                      <span
                        className={`chip shrink-0 ${a.status === "open" ? "chip-accent" : ""}`}
                      >
                        {a.status === "open" ? "Open" : "Done"}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="chip">{forWhom}</span>
                      {a.stage && <span className="chip">{stageDef(a.stage).short}</span>}
                    </div>

                    {record ? (
                      <Link
                        href={`/records/${record.slug}`}
                        className="tnum mt-2 flex min-h-[2.25rem] items-center text-[0.75rem] uppercase tracking-[0.12em] text-[var(--accent)]"
                      >
                        {record.address}
                      </Link>
                    ) : (
                      <p className="label mt-2">Property not on your file yet</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="eyebrow">Properties</h2>
          {summaries.length === 0 ? (
            <div className="card mt-2.5 px-4 py-5">
              <p className="label">No properties on file</p>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                {org
                  ? "Open a record with the address below. You can film the first stage the moment it exists — the record grows one stage at a time and never closes."
                  : "Register your company above, then open the first record with the property address."}
              </p>
            </div>
          ) : (
            <ul className="mt-2.5 space-y-3">
              {summaries.map(({ record, done, working, ticks }) => (
                <li key={record.id}>
                  <Link href={`/records/${record.slug}`} className="card block px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[1rem] font-semibold leading-snug">
                          {record.address}
                        </span>
                        <span className="tnum mt-1 block text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
                          {String(done).padStart(2, "0")}/{STAGES.length} stages
                          {working > 0 ? ` · ${working} building` : ""}
                          {record.owner ? ` · ${record.owner}` : ""}
                        </span>
                      </span>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden
                        className="mt-1 shrink-0"
                      >
                        <path
                          d="m6 3.5 4.5 4.5L6 12.5"
                          stroke="var(--ink-3)"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>

                    <span className="comb comb-11 mt-3" aria-hidden>
                      {ticks.map((t, i) => (
                        <span
                          key={STAGES[i].id}
                          className="tick"
                          style={TICK_COLOR[t] ? { background: TICK_COLOR[t] } : undefined}
                        />
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {org && (
          <section className="card overflow-hidden">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h2 className="eyebrow">Start a record</h2>
            </div>
            <form action={createRecordAction} className="space-y-4 px-4 py-4">
              <div>
                <label className="label block" htmlFor="address">
                  Property address
                </label>
                <input
                  id="address"
                  name="address"
                  required
                  placeholder="1418 Ridgemont Dr"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="owner">
                  Homeowner <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="owner"
                  name="owner"
                  placeholder="Who inherits this record"
                  className="input mt-1.5"
                />
              </div>
              <button type="submit" className="btn btn-primary w-full">
                Create record
              </button>
            </form>
          </section>
        )}

        {org && <p className="eyebrow text-center">Filed to {org.name}</p>}
      </main>
    </>
  );
}
