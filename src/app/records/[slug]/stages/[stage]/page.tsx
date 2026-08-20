import dynamicImport from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
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
  const simulated = capture?.glbUrl === "procedural://framed-room";

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
              <ModelViewer url={capture.glbUrl} className="h-[70vw] max-h-[26rem] w-full" />
              <dl className="grid grid-cols-3 divide-x divide-[var(--line)] border-t border-[var(--line)]">
                <Stat label="Filmed" value={formatDate(capture.createdAt)} />
                <Stat
                  label="Frames"
                  value={metrics ? `${metrics.framesRegistered}/${metrics.framesSubmitted}` : "—"}
                />
                <Stat
                  label="Size"
                  value={metrics ? `${(metrics.glbBytes / 1_048_576).toFixed(1)} MB` : "—"}
                />
              </dl>
              {geometry && !simulated && (
                <dl className="grid grid-cols-2 divide-x divide-[var(--line)] border-t border-[var(--line)]">
                  <Stat
                    label="Floor area"
                    value={`${Math.round(geometry.floorAreaM2 / 0.092903)} sf`}
                  />
                  <Stat
                    label="Ceiling"
                    value={
                      geometry.ceilingHeightM
                        ? `${(geometry.ceilingHeightM / 0.3048).toFixed(1)} ft`
                        : "—"
                    }
                  />
                </dl>
              )}
              {simulated && (
                <p className="border-t border-[var(--line)] px-5 py-3 text-xs leading-relaxed text-[var(--ink-3)]">
                  Simulated geometry — no reconstruction endpoint was configured when this stage
                  was filmed. This is not a model of the room you filmed.
                </p>
              )}
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
              Refilming replaces this stage&apos;s model.
            </p>
          </>
        ) : (
          <>
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <dt className="label">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}
