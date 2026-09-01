import dynamicImport from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import CaptureFlow from "@/components/CaptureFlow";
import PartsTable from "@/components/PartsTable";
import QualityPanel from "@/components/QualityPanel";
import { currentKey } from "@/lib/auth";
import { reconConfigured } from "@/lib/recon";
import { STAGES, isStageId, stageDef, stageIndex } from "@/lib/stages";
import { blobConfigured } from "@/lib/storage";
import { getRecord, listCaptures } from "@/lib/store";
import type { ReconMetrics, SceneGeometry } from "@/lib/types";

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

const SCALE_SOURCE: Record<ReconMetrics["scaleSource"], string> = {
  reference_object: "Reference",
  stud_spacing: "Framing",
  assumed: "Assumed",
};

export default async function StagePage({ params }: PageProps<"/records/[slug]/stages/[stage]">) {
  const key = await currentKey();
  if (!key) redirect("/");

  const { slug, stage } = await params;
  if (!isStageId(stage)) notFound();

  const record = await getRecord(slug, key.id);
  if (!record) notFound();

  const def = stageDef(stage);
  const position = stageIndex(stage) + 1;
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
        eyebrow={`Stage ${String(position).padStart(2, "0")} of ${STAGES.length}`}
        title={def.label}
        subtitle={def.blurb}
        meta={done && capture ? `Filmed ${formatDate(capture.createdAt)}` : undefined}
      />

      <main className="shell flex-1 space-y-6 py-5">
        {done && capture?.glbUrl ? (
          <>
            <section className="plate overflow-hidden">
              <ModelViewer url={capture.glbUrl} className="h-[68vw] max-h-[24rem] w-full" />
              <p className="border-y border-[var(--line)] px-4 py-2 text-center text-[0.5625rem] uppercase tracking-[0.18em] text-[var(--ink-3)]">
                Drag to orbit · pinch to zoom
              </p>

              {simulated && (
                <p className="border-b border-[var(--line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--grade-c)]">
                  Simulated geometry. No reconstruction endpoint was configured when this stage was
                  filmed, so this is stand-in framing — not a model of the room you walked.
                </p>
              )}

              <dl className="rule-grid grid-cols-3 border-t-0">
                <Field
                  term="Frames"
                  value={metrics ? `${metrics.framesRegistered}/${metrics.framesSubmitted}` : "—"}
                />
                <Field
                  term="Solve"
                  value={metrics ? `${metrics.reprojectionErrorPx.toFixed(2)} px` : "—"}
                />
                <Field term="Scale" value={metrics ? SCALE_SOURCE[metrics.scaleSource] : "—"} />
                <Field term="Points" value={metrics ? compact(metrics.pointCount) : "—"} />
                <Field
                  term="Mesh"
                  value={metrics ? `${compact(metrics.triangleCount)} tri` : "—"}
                />
                <Field
                  term="Model"
                  value={metrics ? `${(metrics.glbBytes / 1_048_576).toFixed(1)} MB` : "—"}
                />
              </dl>
            </section>

            {geometry && !simulated && <MeasuredGeometry geometry={geometry} />}

            {capture.quality ? (
              <QualityPanel report={capture.quality} stageLabel={def.label} />
            ) : (
              <section className="card px-4 py-4">
                <h2 className="eyebrow">Assessment</h2>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                  This stage was filmed before the 50-point ledger existed, so it carries a model
                  but no grade. Refilm it to have it assessed.
                </p>
              </section>
            )}

            <PartsTable parts={capture.parts} />

            <section>
              <h2 className="eyebrow">Refilm this stage</h2>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                A new walk replaces the model, the ledger, and the parts list above. The old one is
                not kept.
              </p>
              <div className="mt-3">
                <CaptureFlow
                  slug={slug}
                  stage={stage}
                  captureGuide={def.captureGuide}
                  blobEnabled={blobConfigured}
                  reconEnabled={reconConfigured}
                  activeCaptureId={null}
                  initialSteps={[]}
                />
              </div>
            </section>
          </>
        ) : (
          <>
            {capture?.state === "failed" && (
              <section className="card px-4 py-4" style={{ borderColor: "var(--grade-f)" }}>
                <h2 className="eyebrow" style={{ color: "var(--grade-f)" }}>
                  Reconstruction failed
                </h2>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                  {capture.job?.error ??
                    "The solver could not build a model from this walk. Film it again, slower, with more overlap between passes."}
                </p>
              </section>
            )}

            <CaptureFlow
              slug={slug}
              stage={stage}
              captureGuide={def.captureGuide}
              blobEnabled={blobConfigured}
              reconEnabled={reconConfigured}
              activeCaptureId={inFlight ? capture!.id : null}
              initialSteps={capture?.job?.steps ?? []}
            />

            {!inFlight && (
              <section className="card overflow-hidden">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="eyebrow">What is checked here</h2>
                </div>
                <ul className="px-4 py-3">
                  {def.checklist.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2.5 py-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]"
                    >
                      <span
                        className="mt-[0.4375rem] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]"
                        aria-hidden
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function MeasuredGeometry({ geometry }: { geometry: SceneGeometry }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="eyebrow">Measured off the model</h2>
      </div>
      <dl className="rule-grid grid-cols-2 border-t-0">
        <Field term="Floor area" value={`${Math.round(geometry.floorAreaM2 / 0.092903)} sf`} />
        <Field term="Wall area" value={`${Math.round(geometry.wallAreaM2 / 0.092903)} sf`} />
        <Field
          term="Ceiling"
          value={
            geometry.ceilingHeightM ? `${(geometry.ceilingHeightM / 0.3048).toFixed(1)} ft` : "—"
          }
        />
        <Field
          term="Framing"
          value={geometry.studSpacingIn ? `${geometry.studSpacingIn.toFixed(1)} in OC` : "—"}
        />
      </dl>
      <p className="border-t border-[var(--line)] px-4 py-3 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">
        {geometry.planes.length} plane{geometry.planes.length === 1 ? "" : "s"} fitted to the mesh —
        walls, floors, and ceilings. Plumb, level, and flatness in the ledger are measured against
        these.
      </p>
    </section>
  );
}

function Field({ term, value }: { term: string; value: string }) {
  return (
    <div className="field">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
