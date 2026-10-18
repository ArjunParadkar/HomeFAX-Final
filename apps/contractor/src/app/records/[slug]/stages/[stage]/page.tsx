import dynamicImport from "next/dynamic";
import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import CaptureFlow from "@/components/CaptureFlow";
import { ErrorLine, PartsTable, QualityPanel } from "@homefax/ui";
import { viewProperty } from "@homefax/app-kit";
import { STAGES, isStageId, reconConfigured, stageDef, stageIndex } from "@homefax/core";
import type { ReconMetrics, SceneGeometry } from "@homefax/core";
import { oversight, records, type LoanDraw } from "@homefax/db";
import { requestDrawAction } from "@/app/records/actions";
import { formatDate, streetOf } from "@/lib/address";
import { kit } from "@/lib/kit";
import { orgContext } from "@/lib/session";
import { blobConfigured } from "@/lib/storage";

const ModelViewer = dynamicImport(() => import("@homefax/ui/model-viewer"));

export const dynamic = "force-dynamic";

const SCALE_SOURCE: Record<ReconMetrics["scaleSource"], string> = {
  reference_object: "Reference",
  stud_spacing: "Framing",
  assumed: "Assumed",
};

const DRAW_WORD: Record<LoanDraw["status"], string> = {
  requested: "Requested",
  verified: "Verified",
  released: "Released",
  held: "Held",
  rejected: "Rejected",
};

const DRAW_COLOR: Record<LoanDraw["status"], string> = {
  requested: "var(--accent)",
  verified: "var(--grade-b)",
  released: "var(--grade-a)",
  held: "var(--grade-c)",
  rejected: "var(--grade-f)",
};

export default async function StagePage({ params, searchParams }: PageProps<"/records/[slug]/stages/[stage]">) {
  const { slug, stage } = await params;
  const sp = await searchParams;
  if (!isStageId(stage)) notFound();

  const data = await kit.asMe(async (tx, me) => {
    const found = await records.getRecordBySlug(tx, slug);
    if (!found) return null;
    const { org } = await orgContext(tx, me);
    const view = await viewProperty(tx, found.property.id, { identityId: me.identity.id }, { app: "contractor", path: `/records/${slug}/stages/${stage}`, orgId: org?.id });
    if (!view) return null;
    const capture = (await records.listCaptures(tx, found.record.id)).find((c) => c.stage === stage) ?? null;

    // A lender with a construction loan on the house shows up through its draws;
    // a contractor cannot read the loan itself, only what has been asked against it.
    const draws = await oversight.listDrawsForProperty(tx, found.property.id);
    const holdingIds = [...new Set(draws.map((d) => d.holdingId))];
    const recommendation = capture?.state === "done" && holdingIds.length > 0 ? await oversight.recommendDraw(tx, found.property.id, stage) : null;
    return { ...found, capture, draws, holdingIds, recommendation };
  });
  if (!data) notFound();

  const { property, capture, draws, holdingIds, recommendation } = data;
  const def = stageDef(stage);
  const position = stageIndex(stage) + 1;
  const inFlight = capture != null && records.IN_FLIGHT_STATES.has(capture.state);
  const done = capture?.state === "done";
  const metrics = capture?.job?.result?.metrics;
  const geometry = capture?.job?.result?.geometry;
  const simulated = capture?.glbUrl?.startsWith("procedural://") ?? false;
  const stageDraws = draws.filter((d) => d.stage === stage);
  const lenderOnFile = holdingIds.length > 0;

  return (
    <>
      <AppHeader
        back={{ href: `/records/${slug}`, label: streetOf(property) }}
        eyebrow={`Stage ${String(position).padStart(2, "0")} of ${STAGES.length}`}
        title={def.label}
        subtitle={def.blurb}
        meta={done && capture ? `Filmed ${formatDate(capture.createdAt, { month: "short", day: "numeric" })}` : undefined}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />
        {sp.ok === "draw" && (
          <p role="status" className="text-[0.8125rem] leading-relaxed" style={{ color: "var(--claude)" }}>
            Draw requested. The lender sees it next to the grade and the ledger, and decides in their own app.
          </p>
        )}

        {done && capture?.glbUrl ? (
          <>
            <section className="plate overflow-hidden">
              <ModelViewer url={capture.glbUrl} className="h-[68vw] max-h-[24rem] w-full" />
              <p className="border-y border-[var(--line)] px-4 py-2 text-center text-[0.5625rem] uppercase tracking-[0.18em] text-[var(--ink-3)]">
                Drag to orbit · pinch to zoom
              </p>

              {simulated && (
                <p className="border-b border-[var(--line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--grade-c)]">
                  Simulated geometry. No reconstruction endpoint was configured when this stage was filmed, so this is stand-in framing — not a
                  model of the room you walked.
                </p>
              )}

              <dl className="rule-grid grid-cols-3 border-t-0">
                <Field term="Frames" value={metrics ? `${metrics.framesRegistered}/${metrics.framesSubmitted}` : "—"} />
                <Field term="Solve" value={metrics ? `${metrics.reprojectionErrorPx.toFixed(2)} px` : "—"} />
                <Field term="Scale" value={metrics ? SCALE_SOURCE[metrics.scaleSource] : "—"} />
                <Field term="Points" value={metrics ? compact(metrics.pointCount) : "—"} />
                <Field term="Mesh" value={metrics ? `${compact(metrics.triangleCount)} tri` : "—"} />
                <Field term="Model" value={metrics ? `${(metrics.glbBytes / 1_048_576).toFixed(1)} MB` : "—"} />
              </dl>
            </section>

            {geometry && !simulated && <MeasuredGeometry geometry={geometry} />}

            {capture.quality ? (
              <QualityPanel report={capture.quality} stageLabel={def.label} />
            ) : (
              <section className="card px-4 py-4">
                <h2 className="eyebrow">Assessment</h2>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                  This stage was filmed before the 50-point ledger existed, so it carries a model but no grade. Refilm it to have it assessed.
                </p>
              </section>
            )}

            {lenderOnFile && (
              <section className="card overflow-hidden">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="eyebrow">Construction draw</h2>
                </div>

                {stageDraws.length > 0 && (
                  <ul>
                    {stageDraws.map((d) => (
                      <li key={d.id} className="border-b border-[var(--line)] px-4 py-3">
                        <div className="flex items-start gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="tnum block text-[1rem] font-semibold leading-snug">{money(d.amountCents)}</span>
                            <span className="tnum mt-0.5 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                              Requested {formatDate(d.requestedAt)}
                              {d.decidedAt ? ` · decided ${formatDate(d.decidedAt)}` : ""}
                            </span>
                          </span>
                          <span className="chip shrink-0" style={{ borderColor: DRAW_COLOR[d.status], color: DRAW_COLOR[d.status] }}>
                            {DRAW_WORD[d.status]}
                          </span>
                        </div>
                        {d.decisionNote && <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{d.decisionNote}</p>}
                      </li>
                    ))}
                  </ul>
                )}

                {recommendation && (
                  <div className="border-b border-[var(--line)] px-4 py-3.5">
                    <p className="label">
                      The record says:{" "}
                      <span style={{ color: recommendation.recommendation === "release" ? "var(--grade-a)" : "var(--grade-c)" }}>
                        {recommendation.recommendation === "release" ? "release" : "hold"}
                      </span>
                    </p>
                    <ul className="mt-1.5">
                      {recommendation.reasons.map((r) => (
                        <li key={r} className="flex gap-2.5 py-0.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                          <span className="mt-[0.4375rem] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <form action={requestDrawAction} className="space-y-3.5 px-4 py-4">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="propertyId" value={property.id} />
                  <input type="hidden" name="stage" value={stage} />
                  {holdingIds.length === 1 ? (
                    <input type="hidden" name="holdingId" value={holdingIds[0]} />
                  ) : (
                    <div>
                      <label className="label block" htmlFor="holdingId">
                        Loan
                      </label>
                      <select id="holdingId" name="holdingId" className="input tnum mt-1.5">
                        {holdingIds.map((h, i) => (
                          <option key={h} value={h}>
                            Construction loan {i + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="label block" htmlFor="amount">
                      Amount <span className="normal-case tracking-normal">(USD)</span>
                    </label>
                    <input id="amount" name="amount" required inputMode="decimal" placeholder="8,200" className="input tnum mt-1.5" />
                  </div>
                  <button type="submit" className="btn btn-secondary w-full">
                    Request draw for this stage
                  </button>
                  <p className="text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                    You request; the lender decides. The request carries this stage&apos;s grade and ledger as its basis.
                  </p>
                </form>
              </section>
            )}

            <PartsTable parts={capture.parts} />

            <section>
              <h2 className="eyebrow">Refilm this stage</h2>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                A new walk replaces the model, the ledger, and the parts list above. The old one is not kept.
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
                  {capture.job?.error ?? "The solver could not build a model from this walk. Film it again, slower, with more overlap between passes."}
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
                    <li key={item} className="flex gap-2.5 py-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                      <span className="mt-[0.4375rem] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
                {lenderOnFile && (
                  <p className="border-t border-[var(--line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                    A lender holds a construction loan on this house. Once this stage is filmed and graded you can request its draw from here.
                  </p>
                )}
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
        <Field term="Ceiling" value={geometry.ceilingHeightM ? `${(geometry.ceilingHeightM / 0.3048).toFixed(1)} ft` : "—"} />
        <Field term="Framing" value={geometry.studSpacingIn ? `${geometry.studSpacingIn.toFixed(1)} in OC` : "—"} />
      </dl>
      <p className="border-t border-[var(--line)] px-4 py-3 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">
        {geometry.planes.length} plane{geometry.planes.length === 1 ? "" : "s"} fitted to the mesh — walls, floors, and ceilings. Plumb, level, and
        flatness in the ledger are measured against these.
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

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
