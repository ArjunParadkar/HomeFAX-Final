import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { GradeBadge, GradeRing } from "@/components/Grade";
import { currentKey } from "@/lib/auth";
import { cumulativeParts, partsSubtotal } from "@/lib/parts";
import { toGrade } from "@/lib/quality";
import { STAGES } from "@/lib/stages";
import { getRecord, listCaptures } from "@/lib/store";
import type { StageId } from "@/lib/types";

export const dynamic = "force-dynamic";

const IN_FLIGHT = new Set(["queued", "extracting", "registering", "reconstructing", "meshing", "analyzing"]);

export default async function RecordPage({ params }: PageProps<"/records/[slug]">) {
  const key = await currentKey();
  if (!key) redirect("/");

  const { slug } = await params;
  const record = await getRecord(slug, key.id);
  if (!record) notFound();

  const captures = await listCaptures(record.id);
  const byStage = new Map(captures.map((c) => [c.stage, c]));

  const graded = captures.filter((c) => c.state === "done" && c.score != null);
  const mean =
    graded.length > 0 ? graded.reduce((a, c) => a + (c.score ?? 0), 0) / graded.length : null;

  const parts = cumulativeParts(
    captures
      .filter((c) => c.state === "done")
      .map((c) => ({ stage: c.stage as StageId, parts: c.parts })),
  );
  const subtotal = partsSubtotal(parts);

  return (
    <>
      <AppHeader
        back={{ href: "/records", label: "Records" }}
        title={record.address}
        subtitle={record.owner ? `For ${record.owner}` : record.contractor ?? undefined}
      />

      <main className="shell flex-1 space-y-6 py-6">
        <section className="card p-5">
          {mean != null ? (
            <GradeRing
              score={mean}
              grade={toGrade(mean)}
              caption={`Average across ${graded.length} recorded stage${graded.length === 1 ? "" : "s"}. Each stage keeps its own grade and findings.`}
            />
          ) : (
            <div>
              <h2 className="text-sm font-semibold">Nothing recorded yet</h2>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                Pick the stage you are standing in and film one slow lap. Everything else follows
                from that.
              </p>
            </div>
          )}
        </section>

        <section>
          <h2 className="label mb-3">Stages</h2>
          <ol>
            {STAGES.map((stage, i) => {
              const capture = byStage.get(stage.id);
              const state = capture?.state;
              return (
                <li key={stage.id} className="rail relative pb-2">
                  <Link
                    href={`/records/${record.slug}/stages/${stage.id}`}
                    className="flex items-center gap-3.5 py-2"
                  >
                    <span
                      className="tnum relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
                      style={{
                        borderColor:
                          state === "done" ? "transparent" : "var(--line)",
                        background:
                          state === "done" ? "var(--accent)" : "var(--surface)",
                        color: state === "done" ? "var(--accent-ink)" : "var(--ink-3)",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-medium leading-snug">
                        {stage.label}
                      </span>
                      <span className="block text-xs text-[var(--ink-3)]">
                        {state === "done"
                          ? capture?.notes
                            ? truncate(capture.notes, 64)
                            : "Recorded"
                          : state === "failed"
                            ? "Reconstruction failed — refilm"
                            : state && IN_FLIGHT.has(state)
                              ? "Processing…"
                              : stage.blurb}
                      </span>
                    </span>
                    {capture?.state === "done" && capture.score != null ? (
                      <GradeBadge grade={toGrade(capture.score)} size="sm" />
                    ) : state && IN_FLIGHT.has(state) ? (
                      <span className="pulsing h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="card overflow-hidden">
          <Link href={`/records/${record.slug}/parts`} className="flex items-center gap-4 p-5">
            <div className="flex-1">
              <h2 className="text-sm font-semibold">Cumulative parts list</h2>
              <p className="mt-0.5 text-xs text-[var(--ink-3)]">
                {parts.length === 0
                  ? "Builds up as stages are recorded"
                  : `${parts.length} line${parts.length === 1 ? "" : "s"} · $${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} in material`}
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
        </section>
      </main>
    </>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
