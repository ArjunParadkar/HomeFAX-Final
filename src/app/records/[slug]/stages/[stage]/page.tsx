import dynamicImport from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import PartsTable from "@/components/PartsTable";
import QualityPanel from "@/components/QualityPanel";
import CaptureFlow from "@/components/CaptureFlow";
import { currentKey } from "@/lib/auth";
import { reconConfigured } from "@/lib/recon";
import { isStageId, stageDef } from "@/lib/stages";
import { blobConfigured } from "@/lib/storage";
import { getRecord, listCaptures } from "@/lib/store";

const ModelViewer = dynamicImport(() => import("@/components/ModelViewer"));

export const dynamic = "force-dynamic";

const IN_FLIGHT = new Set([
  "queued",
  "extracting",
  "registering",
  "reconstructing",
  "meshing",
  "analyzing",
]);

export default async function StagePage({
  params,
}: PageProps<"/records/[slug]/stages/[stage]">) {
  const key = await currentKey();
  if (!key) redirect("/");

  const { slug, stage } = await params;
  if (!isStageId(stage)) notFound();

  const record = await getRecord(slug, key.id);
  if (!record) notFound();

  const def = stageDef(stage);
  const capture = (await listCaptures(record.id)).find((c) => c.stage === stage) ?? null;
  const inFlight = capture != null && IN_FLIGHT.has(capture.state);
  const done = capture?.state === "done";
  const metrics = capture?.job?.result?.metrics;
  const geometry = capture?.job?.result?.geometry;

  return (
    <>
      <AppHeader
        back={{ href: `/records/${slug}`, label: record.address }}
        title={def.label}
        subtitle={def.blurb}
      />

      <main className="shell flex-1 space-y-6 py-6">
        {done && capture?.glbUrl ? (
          <>
            <section className="card overflow-hidden">
              <ModelViewer url={capture.glbUrl} className="h-[62vw] max-h-96 w-full" />
              {metrics && (
                <dl className="grid grid-cols-3 divide-x divide-[var(--line)] border-t border-[var(--line)]">
                  <Stat
                    label="Frames"
                    value={`${metrics.framesRegistered}/${metrics.framesSubmitted}`}
                  />
                  <Stat
                    label="Floor area"
                    value={
                      geometry
                        ? `${Math.round(geometry.floorAreaM2 / 0.092903)} sf`
                        : "—"
                    }
                  />
                  <Stat
                    label="Model"
                    value={`${(metrics.glbBytes / 1_048_576).toFixed(1)} MB`}
                  />
                </dl>
              )}
              {capture.glbUrl === "procedural://framed-room" && (
                <p className="border-t border-[var(--line)] px-5 py-3 text-xs leading-relaxed text-[var(--ink-3)]">
                  Simulated geometry — no reconstruction endpoint was configured when this stage was
                  recorded. Numbers below are computed from it exactly as they would be from a real
                  scan.
                </p>
              )}
            </section>

            {capture.notes && (
              <p className="text-[0.875rem] leading-relaxed text-[var(--ink-2)]">{capture.notes}</p>
            )}

            {capture.quality && <QualityPanel report={capture.quality} />}

            <section className="card overflow-hidden">
              <h2 className="label px-5 pt-4">Parts from this stage</h2>
              <PartsTable parts={capture.parts} showTotals={false} />
            </section>

            <CaptureFlow
              slug={slug}
              stage={stage}
              captureGuide={def.captureGuide}
              blobEnabled={blobConfigured}
              reconEnabled={reconConfigured}
              activeCaptureId={null}
              initialSteps={[]}
            />
            <p className="text-center text-xs text-[var(--ink-3)]">
              Refilming replaces this stage's record.
            </p>
          </>
        ) : (
          <>
            <section>
              <h2 className="label mb-2">What is being checked</h2>
              <ul className="space-y-2">
                {def.checklist.map((c) => (
                  <li
                    key={c}
                    className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--ink-3)]" />
                    {c}
                  </li>
                ))}
              </ul>
            </section>

            <CaptureFlow
              slug={slug}
              stage={stage}
              captureGuide={def.captureGuide}
              blobEnabled={blobConfigured}
              reconEnabled={reconConfigured}
              activeCaptureId={inFlight ? capture!.id : null}
              initialSteps={capture?.job?.steps ?? []}
            />

            {capture?.state === "failed" && capture.job?.error && (
              <p className="text-[0.8125rem] leading-relaxed text-[var(--grade-f)]">
                {capture.job.error}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <dt className="label">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}
