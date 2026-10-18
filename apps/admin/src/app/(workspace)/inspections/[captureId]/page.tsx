import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorLine, QualityPanel } from "@homefax/ui";
import { STAGES, stageDef, stageIndex, type QualityReport } from "@homefax/core";
import { viewProperty } from "@homefax/app-kit";
import { oversight, properties, records } from "@homefax/db";
import { recordReviewAction } from "@/app/(workspace)/inspections/actions";
import { StatusWord, VERDICT_TONE, VERDICT_WORD } from "@/components/bits";
import ModelPlate from "@/components/ModelPlate";
import PageTitle from "@/components/PageTitle";
import Panel from "@/components/Panel";
import { cityOf, date, dateTime, streetOf, titleWord } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * The review room for one filmed stage: the model on the plate, the ledger and
 * findings on paper, and three verdict buttons with a note. The look is logged
 * on the house like any other.
 */
export default async function InspectionPage({ params, searchParams }: PageProps<"/inspections/[captureId]">) {
  await requireKind("municipality");
  const { captureId } = await params;
  const sp = await searchParams;

  const data = await asWorkspace(async (tx, ws) => {
    const cap = await records.getCapture(tx, captureId);
    if (!cap) return null;
    const home = await properties.getProperty(tx, cap.propertyId);
    if (!home) return null;
    const view = await viewProperty(tx, home.id, { identityId: ws.me.identity.id }, { app: "admin", path: `/inspections/${captureId}`, orgId: ws.org.id });
    if (!view) return null;
    const grade = (await records.listStageGrades(tx, home.id)).find((g) => g.captureId === cap.id) ?? null;
    const review = (await oversight.listReviewsForProperty(tx, home.id)).find((r) => r.captureId === cap.id && r.municipalityOrgId === ws.org.id) ?? null;
    const permits = (await oversight.listPermitsForProperty(tx, home.id)).filter((p) => p.municipalityOrgId === ws.org.id);
    return { ws, cap, home, grade, review, permits };
  });
  if (!data) notFound();

  const { cap, home, grade, review, permits } = data;
  const stage = stageDef(cap.stage);
  const quality = cap.quality as QualityReport | null;
  const simulated = Boolean(cap.glbUrl?.startsWith("procedural://") || grade?.simulated);

  return (
    <>
      <PageTitle
        eyebrow={`Inspection · stage ${String(stageIndex(stage.id) + 1).padStart(2, "0")} of ${STAGES.length}`}
        title={`${stage.label} · ${streetOf(home)}`}
        subtitle={`${cityOf(home)} · filmed ${dateTime(cap.createdAt)} · ${cap.frames.length} keyframes${cap.notes ? ` · ${cap.notes}` : ""}`}
        actions={
          <>
            <Link href={`/properties/${home.slug}`} className="btn btn-secondary btn-sm">
              Open the record
            </Link>
            <Link href="/inspections" className="btn btn-secondary btn-sm">
              Back to the queue
            </Link>
          </>
        }
      />
      <ErrorLine message={sp.error} className="mb-4" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          {cap.glbUrl ? (
            <ModelPlate url={cap.glbUrl} stageLabel={stage.label} simulated={simulated} filmed={date(cap.createdAt)} />
          ) : (
            <div className="plate px-5 py-8 text-center text-[0.8125rem] text-[var(--ink-2)]">No model was delivered for this capture.</div>
          )}
          {quality ? (
            <QualityPanel report={quality} stageLabel={stage.label} />
          ) : (
            <Panel title="Ledger">
              <p className="text-[0.8125rem] text-[var(--ink-2)]">This capture has not been graded; the reconstruction is {cap.state}.</p>
            </Panel>
          )}
        </div>

        <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <Panel title="Verdict" meta={review ? <StatusWord tone={VERDICT_TONE[review.verdict]}>{VERDICT_WORD[review.verdict]} · {date(review.at)}</StatusWord> : "Not yet reviewed"}>
            {review && (
              <p className="sheet mb-4 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                Already {VERDICT_WORD[review.verdict].toLowerCase()} on {dateTime(review.at)}
                {review.notes ? ` — “${review.notes}”` : ""}. Recording again replaces this verdict.
              </p>
            )}
            <form action={recordReviewAction} className="space-y-4">
              <input type="hidden" name="captureId" value={cap.id} />
              <div>
                <label className="label block" htmlFor="notes">
                  Note
                </label>
                <textarea id="notes" name="notes" rows={3} defaultValue={review?.notes ?? ""} placeholder="What you saw, and what the builder should do" className="input input-sm mt-1.5" />
              </div>
              {permits.length > 0 && (
                <div>
                  <label className="label block" htmlFor="permitId">
                    Permit <span className="normal-case tracking-normal">(optional)</span>
                  </label>
                  <select id="permitId" name="permitId" defaultValue={review?.permitId ?? ""} className="input input-sm select mt-1.5">
                    <option value="">Not against a permit</option>
                    {permits.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.permitNo} · {titleWord(p.kind)} · {titleWord(p.status)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <button type="submit" name="verdict" value="verified" className="btn btn-sm" style={{ background: "var(--grade-a)", color: "var(--accent-ink)" }}>
                  Verified
                </button>
                <button type="submit" name="verdict" value="flagged" className="btn btn-sm" style={{ background: "var(--grade-f)", color: "var(--accent-ink)" }}>
                  Flagged
                </button>
                <button type="submit" name="verdict" value="site_visit" className="btn btn-secondary btn-sm">
                  Site visit
                </button>
              </div>
              <p className="text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">Verified and flagged change the house&apos;s stats; a site visit records that the capture could not settle it. All three land on the owner&apos;s timeline with your note.</p>
            </form>
          </Panel>

          {grade && (
            <Panel title="Measured" meta={grade.visionStatus === "graded" ? "Geometry + visual review" : "Geometry only"}>
              <dl className="rule-grid grid-cols-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)]">
                <div className="field">
                  <dt>Capture</dt>
                  <dd>{grade.captureScore != null ? Math.round(grade.captureScore) : "—"}</dd>
                </div>
                <div className="field">
                  <dt>Geometry</dt>
                  <dd>{grade.geometryScore != null ? Math.round(grade.geometryScore) : "—"}</dd>
                </div>
                <div className="field">
                  <dt>Workmanship</dt>
                  <dd>{grade.workmanshipScore != null ? Math.round(grade.workmanshipScore) : "—"}</dd>
                </div>
                <div className="field">
                  <dt>Compliance</dt>
                  <dd>{grade.complianceScore != null ? Math.round(grade.complianceScore) : "—"}</dd>
                </div>
              </dl>
              {simulated && <p className="mt-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">The geometry is a simulated stand-in — no real reconstruction was run. Treat the measured dimensions as a demonstration of the instrument, not of this house.</p>}
            </Panel>
          )}

          {cap.frames.length > 0 && (
            <Panel title="Keyframes" meta={`${cap.frames.length}`}>
              <ul className="grid grid-cols-3 gap-1.5">
                {cap.frames.slice(0, 9).map((f, i) => (
                  <li key={f} className="overflow-hidden rounded-[6px] border border-[var(--line)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f} alt={`Keyframe ${i + 1} of the ${stage.label.toLowerCase()} capture`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
