import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { STAGES } from "@/lib/stages";
import { currentKey } from "@/lib/auth";
import { listCaptures, listRecords } from "@/lib/store";
import { createRecordAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const key = await currentKey();
  if (!key) redirect("/");

  const records = await listRecords(key.id);
  const summaries = await Promise.all(
    records.map(async (r) => {
      const captures = await listCaptures(r.id);
      const done = captures.filter((c) => c.state === "done").length;
      return { record: r, done, total: STAGES.length };
    }),
  );

  return (
    <>
      <AppHeader title="Your records" subtitle={key.label} />
      <main className="shell flex-1 space-y-6 py-6">
        {summaries.length === 0 ? (
          <p className="text-sm leading-relaxed text-[var(--ink-2)]">
            No homes on file yet. Start one below — you can film the first stage straight after.
          </p>
        ) : (
          <ul className="space-y-3">
            {summaries.map(({ record, done, total }) => (
              <li key={record.id}>
                <Link href={`/records/${record.slug}`} className="card flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-semibold leading-snug">
                      {record.address}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ink-3)]">
                      <span className="tnum">
                        {done}/{total}
                      </span>{" "}
                      stages filmed
                      {record.owner ? ` · ${record.owner}` : ""}
                    </p>
                  </div>
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="m6 3.5 4.5 4.5L6 12.5"
                      stroke="var(--ink-3)"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section className="card p-5">
          <h2 className="text-sm font-semibold">Start a new record</h2>
          <form action={createRecordAction} className="mt-3 space-y-3">
            <div>
              <label className="label block" htmlFor="address">
                Property address
              </label>
              <input
                id="address"
                name="address"
                required
                placeholder="1418 Ridgemont Dr"
                className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-base outline-none focus:border-[var(--accent)]"
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
                className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-base outline-none focus:border-[var(--accent)]"
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Create record
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
