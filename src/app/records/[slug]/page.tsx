import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import PartsTable from "@/components/PartsTable";
import { GradeChip } from "@/components/Grade";
import { currentKey } from "@/lib/auth";
import { cumulativeParts } from "@/lib/parts";
import { STAGES } from "@/lib/stages";
import { getRecord, listCaptures } from "@/lib/store";

export const dynamic = "force-dynamic";

const IN_FLIGHT = new Set([
  "queued",
  "extracting",
  "registering",
  "reconstructing",
  "meshing",
  "analyzing",
]);

export default async function RecordPage({ params }: PageProps<"/records/[slug]">) {
  const key = await currentKey();
  if (!key) redirect("/");

  const { slug } = await params;
  const record = await getRecord(slug, key.id);
  if (!record) notFound();

  const captures = await listCaptures(record.id);
  const byStage = new Map(captures.map((c) => [c.stage, c]));
  const recorded = captures.filter((c) => c.state === "done").length;

  // Ledger totals across every stage that has been assessed. Summed, never
  // averaged — a point is passed on a stage or it is not.
  let passed = 0;
  let assessed = 0;
  for (const c of captures) {
    const q = c.quality;
    if (!q?.checkpoints?.length) continue;
    passed += q.checkpointsPassed ?? q.checkpoints.filter((p) => p.status === "pass").length;
    assessed +=
      q.checkpointsAssessed ?? q.checkpoints.filter((p) => p.status !== "not_assessable").length;
  }

  const rollup = cumulativeParts(
    captures
      .filter((c) => c.state === "done" && c.parts.length > 0)
      .map((c) => ({ stage: c.stage, parts: c.parts })),
  );

  return (
    <>
      <AppHeader
        back={{ href: "/records", label: "On file" }}
        eyebrow="Build record"
        title={record.address}
        subtitle={record.owner ? `Held for ${record.owner}` : (record.contractor ?? undefined)}
        meta={`${String(recorded).padStart(2, "0")}/${STAGES.length}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <section className="card overflow-hidden">
          <dl className="rule-grid grid-cols-2 border-t-0">
            <div className="field">
              <dt>Opened</dt>
              <dd>{formatDate(record.createdAt)}</dd>
            </div>
            <div className="field">
              <dt>Stages on file</dt>
              <dd>
                {recorded} / {STAGES.length}
              </dd>
            </div>
            <div className="field">
              <dt>Points passed</dt>
              <dd>{assessed > 0 ? `${passed} / ${assessed}` : "—"}</dd>
            </div>
            <div className="field">
              <dt>Filed by</dt>
              <dd className="truncate">{record.contractor ?? key.label}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="eyebrow">The sequence</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Stages close in order and never reopen. Tap one to film it, or to read what is already
            on the record.
          </p>

          <ol className="mt-3">
            {STAGES.map((stage, i) => {
              const capture = byStage.get(stage.id);
              const state = capture?.state;
              const done = state === "done";
              const working = state != null && IN_FLIGHT.has(state);
              const grade = capture?.quality?.grade;
              return (
                <li key={stage.id} className="rail relative pb-1.5">
                  <Link
                    href={`/records/${record.slug}/stages/${stage.id}`}
                    className="flex min-h-[3.25rem] items-center gap-3.5 py-2"
                  >
                    <span
                      className="tnum relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold"
                      style={{
                        borderColor: done ? "transparent" : "var(--line)",
                        background: done ? "var(--accent)" : "var(--surface)",
                        color: done ? "var(--accent-ink)" : "var(--ink-3)",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-medium leading-snug">
                        {stage.label}
                      </span>
                      <span className="tnum block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                        {done
                          ? "Model on file"
                          : state === "failed"
                            ? "Failed — refilm"
                            : working
                              ? "Building model"
                              : "Not filmed"}
                      </span>
                    </span>
                    {grade ? (
                      <GradeChip grade={grade} size="sm" />
                    ) : done ? (
                      <ModelMark />
                    ) : working ? (
                      <span className="pulsing h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        {rollup.length > 0 && (
          <details className="group">
            <summary className="card flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="eyebrow block">Materials on the record</span>
                <span className="mt-1 block text-[0.8125rem] leading-snug text-[var(--ink-2)]">
                  Every stage rolled into one list
                </span>
              </span>
              <span className="tnum shrink-0 text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
                {rollup.length} lines
              </span>
              <svg
                className="shrink-0 transition-transform duration-150 group-open:rotate-90"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <path
                  d="m6 3.5 4.5 4.5L6 12.5"
                  stroke="var(--ink-3)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <div className="mt-3">
              <PartsTable
                parts={rollup}
                title="Cumulative takeoff"
                note="One line per material across the whole build. Where a later stage measured what an earlier one estimated, the measured count replaces it rather than ordering twice."
              />
            </div>
          </details>
        )}
      </main>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ModelMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label="Model on file">
      <path
        d="M10 2.6 17 6.5v7L10 17.4 3 13.5v-7L10 2.6Z"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 6.5 10 10.4l7-3.9M10 10.4v7" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
