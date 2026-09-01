import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { STAGES } from "@/lib/stages";
import { currentKey } from "@/lib/auth";
import { listCaptures, listRecords } from "@/lib/store";
import { createRecordAction } from "./actions";

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

export default async function RecordsPage() {
  const key = await currentKey();
  if (!key) redirect("/");

  const records = await listRecords(key.id);
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
      return {
        record: r,
        done: ticks.filter((t) => t === "done").length,
        working: ticks.filter((t) => t === "working").length,
        ticks,
      };
    }),
  );

  return (
    <>
      <AppHeader
        eyebrow="Build records"
        title="On file"
        subtitle={key.label}
        meta={`${summaries.length} home${summaries.length === 1 ? "" : "s"}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        {summaries.length === 0 ? (
          <section className="card px-4 py-5">
            <h2 className="text-[0.9375rem] font-semibold">No homes on file yet</h2>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Start a record below with the property address. You can film the first stage the
              moment it exists — the record grows one stage at a time and never closes.
            </p>
          </section>
        ) : (
          <ul className="space-y-3">
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

        <p className="eyebrow text-center">Filed to {key.label}</p>
      </main>
    </>
  );
}
