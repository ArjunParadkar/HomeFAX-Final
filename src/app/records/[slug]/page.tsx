import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { currentKey } from "@/lib/auth";
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

  return (
    <>
      <AppHeader
        back={{ href: "/records", label: "Records" }}
        title={record.address}
        subtitle={record.owner ? `For ${record.owner}` : (record.contractor ?? undefined)}
      />

      <main className="shell flex-1 space-y-6 py-6">
        <p className="text-sm leading-relaxed text-[var(--ink-2)]">
          <span className="tnum font-semibold text-[var(--ink)]">
            {recorded} of {STAGES.length}
          </span>{" "}
          stages have a model. Tap a stage to film it or to open what is already there.
        </p>

        <section>
          <ol>
            {STAGES.map((stage, i) => {
              const capture = byStage.get(stage.id);
              const state = capture?.state;
              const done = state === "done";
              const working = state != null && IN_FLIGHT.has(state);
              return (
                <li key={stage.id} className="rail relative pb-2">
                  <Link
                    href={`/records/${record.slug}/stages/${stage.id}`}
                    className="flex items-center gap-3.5 py-2"
                  >
                    <span
                      className="tnum relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
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
                      <span className="block text-xs text-[var(--ink-3)]">
                        {done
                          ? "Model ready"
                          : state === "failed"
                            ? "Reconstruction failed — refilm"
                            : working
                              ? "Building model…"
                              : "Not filmed"}
                      </span>
                    </span>
                    {done ? (
                      <ModelDot />
                    ) : working ? (
                      <span className="pulsing h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      </main>
    </>
  );
}

function ModelDot() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label="Model ready">
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
