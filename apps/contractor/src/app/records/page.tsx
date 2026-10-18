import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { ErrorLine, StatStrip } from "@homefax/ui";
import { STAGES, stageDef } from "@homefax/core";
import { properties, records, type Assignment, type BuildRecord, type Property } from "@homefax/db";
import { createCompanyAction, setActiveOrgAction } from "@/app/account/actions";
import { cityLineOf, streetOf } from "@/lib/address";
import { kit } from "@/lib/kit";
import { orgContext } from "@/lib/session";
import { createRecordAction } from "./actions";

/**
 * On file — the home tab. What this company has recorded, what the reader
 * personally owes someone this week, and the one form that opens a new record.
 *
 * The strip at the top counts things that exist, not things that were
 * computed: properties, stages filmed, ledger points passed, open tasks. They
 * come straight from each house's stats row.
 */

export const dynamic = "force-dynamic";

type TickState = records.StageStatus["state"];

const TICK_COLOR: Record<TickState, string | undefined> = {
  done: "var(--accent)",
  working: "color-mix(in oklab, var(--accent) 40%, transparent)",
  failed: "var(--grade-f)",
  open: undefined,
};

const DEFAULT_PLACE = { city: "Bentonville", state: "AR", zip: "72712" };

export default async function RecordsPage({ searchParams }: PageProps<"/records">) {
  const sp = await searchParams;

  const data = await kit.asMe(async (tx, me) => {
    const { orgs: mine, org } = await orgContext(tx, me);
    const rows = org ? await records.listRecordsForOrg(tx, org.id) : [];
    const summaries = [];
    for (const r of rows) summaries.push({ ...r, ticks: await records.stageStatuses(tx, r.property.id) });

    // Direct assignments plus everything landed on a company the reader is in.
    const assignments = (await records.listAssignmentsForIdentity(tx, me.identity.id, mine.map((o) => o.id))).sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Name each assignment's property where the reader may see it. Row-level
    // security decides; anything it hides stays unnamed rather than guessed.
    const visible = new Map<string, { record: BuildRecord; property: Property }>();
    for (const r of rows) visible.set(r.record.id, { record: r.record, property: r.property });
    for (const id of new Set(assignments.map((a) => a.recordId))) {
      if (visible.has(id)) continue;
      const record = await records.getRecord(tx, id);
      const property = record ? await properties.getProperty(tx, record.propertyId) : null;
      if (record && property) visible.set(id, { record, property });
    }

    const last = rows[0]?.property;
    return {
      me,
      mine,
      org,
      summaries,
      assignments,
      visible,
      place: last ? { city: last.city, state: last.state, zip: last.postalCode } : DEFAULT_PLACE,
    };
  });

  const { me, mine, org, summaries, assignments, visible, place } = data;
  const orgNames = new Map(mine.map((o) => [o.id, o.name]));
  const filmed = summaries.reduce((n, s) => n + s.stats.stagesFilmed, 0);
  const passed = summaries.reduce((n, s) => n + s.stats.pointsPassed, 0);
  const assessed = summaries.reduce((n, s) => n + s.stats.pointsAssessed, 0);
  const openCount = assignments.filter((a) => a.status === "open").length;
  const claimed = Array.isArray(sp.claimed) ? sp.claimed[0] : sp.claimed;

  return (
    <>
      <AppHeader
        nav="records"
        eyebrow="Build records"
        title="On file"
        subtitle={org ? org.name : "No company yet"}
        meta={`${summaries.length} home${summaries.length === 1 ? "" : "s"}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />
        {claimed != null && (
          <p role="status" className="text-[0.8125rem] leading-relaxed" style={{ color: "var(--claude)" }}>
            {claimed === "0" ? "That key had no unclaimed records." : `${claimed} record${claimed === "1" ? "" : "s"} moved to ${org?.name ?? "your company"}.`}
          </p>
        )}

        {mine.length > 1 && (
          <section>
            <h2 className="eyebrow">Filing as</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {mine.map((o) => {
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
                { term: "Properties on file", value: String(summaries.length) },
                { term: "Stages filmed", value: String(filmed) },
                { term: "Points passed", value: assessed > 0 ? `${passed} / ${assessed}` : "—" },
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
                <input id="company-name" name="name" required placeholder="Reyes Framing" className="input mt-1.5" />
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
              {assignments.map((a: Assignment) => {
                const hit = visible.get(a.recordId);
                const forWhom =
                  a.assigneeIdentityId === me.identity.id ? "You" : (orgNames.get(a.assigneeOrgId ?? "") ?? "Your company");
                return (
                  <li key={a.id} className="card px-4 py-3">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">{a.task}</p>
                      <span className={`chip shrink-0 ${a.status === "open" ? "chip-accent" : ""}`}>
                        {a.status === "open" ? "Open" : "Done"}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="chip">{forWhom}</span>
                      {a.stage && <span className="chip">{stageDef(a.stage).short}</span>}
                    </div>

                    {hit ? (
                      <Link
                        href={`/records/${hit.record.slug}`}
                        className="tnum mt-2 flex min-h-[2.25rem] items-center text-[0.75rem] uppercase tracking-[0.12em] text-[var(--accent)]"
                      >
                        {streetOf(hit.property)}
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
              {summaries.map(({ record, property, stats, ticks }) => (
                <li key={record.id}>
                  <Link href={`/records/${record.slug}`} className="card block px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[1rem] font-semibold leading-snug">{streetOf(property)}</span>
                        <span className="tnum mt-1 block truncate text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
                          {String(stats.stagesFilmed).padStart(2, "0")}/{STAGES.length} stages
                          {stats.stagesInFlight > 0 ? ` · ${stats.stagesInFlight} building` : ""}
                          {record.ownerName ? ` · ${record.ownerName}` : ` · ${cityLineOf(property)}`}
                        </span>
                      </span>
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-1 shrink-0">
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
                      {ticks.map((t) => (
                        <span
                          key={t.stage}
                          className="tick"
                          style={TICK_COLOR[t.state] ? { background: TICK_COLOR[t.state] } : undefined}
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
                  Street address
                </label>
                <input id="address" name="address" required placeholder="1418 Ridgemont Dr" autoComplete="street-address" className="input mt-1.5" />
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                  Or type the whole address on one line — &ldquo;1418 Ridgemont Dr, Bentonville, AR 72712&rdquo; — and the fields below are ignored.
                </p>
              </div>
              <div>
                <label className="label block" htmlFor="line2">
                  Unit <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input id="line2" name="line2" placeholder="Unit 3" autoComplete="address-line2" className="input mt-1.5" />
              </div>
              <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
                <div>
                  <label className="label block" htmlFor="city">
                    City
                  </label>
                  <input id="city" name="city" defaultValue={place.city} autoComplete="address-level2" className="input mt-1.5" />
                </div>
                <div>
                  <label className="label block" htmlFor="state">
                    State
                  </label>
                  <input
                    id="state"
                    name="state"
                    defaultValue={place.state}
                    maxLength={2}
                    autoCapitalize="characters"
                    autoComplete="address-level1"
                    className="input tnum mt-1.5 uppercase"
                  />
                </div>
                <div>
                  <label className="label block" htmlFor="zip">
                    ZIP
                  </label>
                  <input id="zip" name="zip" defaultValue={place.zip} inputMode="numeric" autoComplete="postal-code" className="input tnum mt-1.5" />
                </div>
              </div>
              <div>
                <label className="label block" htmlFor="owner">
                  Homeowner <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input id="owner" name="owner" placeholder="Who inherits this record" className="input mt-1.5" />
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
