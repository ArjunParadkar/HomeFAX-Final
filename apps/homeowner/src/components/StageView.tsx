import Link from "next/link";
import type { ReactNode } from "react";
import type { StageDef } from "@homefax/core";
import type { Capture, InspectionReview } from "@homefax/db";
import { formatDay, gradeReading } from "@/lib/format";

/**
 * The body of a stage page, shared by the owner's stage page and the public
 * report: the plate with the model, a one-line reading in the second person,
 * the ledger, the frames, the city's verdict, the materials. The caller
 * decides which of the heavy pieces (viewer, ledger, parts) it may show — the
 * scope ladder lives in the data, not here.
 */

const VERDICT_WORD: Record<InspectionReview["verdict"], string> = {
  verified: "verified this stage",
  flagged: "flagged this stage",
  site_visit: "asked for a site visit on this stage",
};

const VERDICT_COLOR: Record<InspectionReview["verdict"], string> = {
  verified: "var(--grade-a)",
  flagged: "var(--grade-d)",
  site_visit: "var(--grade-c)",
};

export default function StageView({
  capture,
  def,
  reviews,
  viewer,
  quality,
  parts,
  neighbours,
  readerIsOwner = true,
}: {
  capture: Capture | null;
  def: StageDef;
  reviews: (InspectionReview & { orgName: string })[];
  viewer: ReactNode;
  quality: ReactNode;
  parts: ReactNode;
  neighbours?: { prev: { href: string; label: string } | null; next: { href: string; label: string } | null };
  readerIsOwner?: boolean;
}) {
  const done = capture?.state === "done";
  const failed = capture?.state === "failed";
  const working = capture != null && !done && !failed;
  const simulated = capture?.glbUrl === "procedural://framed-room";
  const q = capture?.quality;
  const metrics = capture?.job?.result?.metrics;
  const your = readerIsOwner ? "your" : "the";

  return (
    <>
      {done && capture ? (
        <>
          {viewer && (
            <section className="plate overflow-hidden">
              {viewer}
              <p className="border-y border-[var(--line)] px-4 py-2 text-center text-[0.5625rem] uppercase tracking-[0.18em] text-[var(--ink-3)]">
                Drag to orbit · pinch to zoom
              </p>
              {simulated && (
                <p className="border-b border-[var(--line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--grade-c)]">
                  Simulated geometry. No reconstruction endpoint was configured when this stage was filmed, so this is stand-in framing — not a model of the room that was walked.
                </p>
              )}
              <dl className="rule-grid grid-cols-3 border-t-0">
                <Field term="Filmed" value={formatDay(capture.createdAt)} />
                <Field term="Frames kept" value={String(capture.frames.length)} />
                <Field term="Scale" value={metrics ? SCALE_SOURCE[metrics.scaleSource] : "—"} />
              </dl>
            </section>
          )}

          {q && (
            <section className="card px-4 py-4">
              <h2 className="eyebrow">What this means for {your} house</h2>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed">
                {gradeReading(def.label, q.grade, q.score, q.checkpointsAssessed != null ? { passed: q.checkpointsPassed ?? 0, assessed: q.checkpointsAssessed } : null)}
              </p>
              {q.findings.length > 0 ? (
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                  {q.findings.length === 1 ? "One finding is" : `${q.findings.length} findings are`} on record below, each with the frame that shows it.
                  {q.findings.some((f) => f.severity === "critical") && " One is critical — raise it with the builder before this stage is covered."}
                </p>
              ) : (
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">Nothing was flagged on this stage.</p>
              )}
            </section>
          )}

          {reviews.length > 0 && (
            <section className="card overflow-hidden">
              <div className="border-b border-[var(--line)] px-4 py-3">
                <h2 className="eyebrow">The city&apos;s verdict</h2>
              </div>
              <ul>
                {reviews.map((r) => (
                  <li key={r.id} className="border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip" style={{ color: VERDICT_COLOR[r.verdict], borderColor: `color-mix(in oklab, ${VERDICT_COLOR[r.verdict]} 55%, transparent)` }}>
                        {r.verdict.replace("_", " ")}
                      </span>
                      <span className="chip">{formatDay(r.at)}</span>
                    </div>
                    <p className="mt-2 text-[0.9375rem] font-medium leading-snug">
                      {r.orgName} {VERDICT_WORD[r.verdict]}
                    </p>
                    {r.notes && <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{r.notes}</p>}
                    {!r.notes && r.verdict === "verified" && (
                      <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                        The inspector read the filmed record and found nothing to add. A statutory look, not one you granted.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {quality}

          {capture.frames.length > 0 && (
            <section className="card overflow-hidden">
              <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
                <h2 className="eyebrow">Frames kept from the walk</h2>
                <span className="tnum text-[0.625rem] text-[var(--ink-3)]">{capture.frames.length}</span>
              </div>
              <ul className="grid grid-cols-3 gap-px bg-[var(--line)]">
                {capture.frames.map((src, i) => (
                  <li key={src} className="bg-[var(--surface)]">
                    {/* Frames live at arbitrary Blob URLs; the optimiser would need every host whitelisted. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Frame ${i + 1} of the ${def.label.toLowerCase()} walk`} loading="lazy" className="aspect-[4/3] h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
              <p className="px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                The sharpest frames from the walk, numbered the way the ledger and findings refer to them.
              </p>
            </section>
          )}

          {parts}
        </>
      ) : (
        <section className="card px-4 py-4" style={failed ? { borderColor: "var(--grade-f)" } : undefined}>
          <h2 className="eyebrow" style={failed ? { color: "var(--grade-f)" } : undefined}>
            {failed ? "Reconstruction failed" : working ? "Being built" : "Not filmed yet"}
          </h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {failed
              ? "The solver could not build a model from the walk your builder filmed. They have been asked to film it again; the stage stays open until then."
              : working && capture
                ? `Your builder filmed this stage on ${formatDay(capture.createdAt)}. The model, the ledger and the parts list appear here once the reconstruction finishes.`
                : "Nothing is on the record for this stage yet. When your builder films it, the model, the 50-point ledger and the materials list arrive together."}
          </p>
          {!working && (
            <>
              <p className="label mt-4">What will be checked here</p>
              <ul className="mt-1">
                {def.checklist.map((item) => (
                  <li key={item} className="flex gap-2.5 py-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                    <span className="mt-[0.4375rem] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {neighbours && (neighbours.prev || neighbours.next) && (
        <nav aria-label="Neighbouring stages" className="flex gap-2">
          {neighbours.prev ? (
            <Link href={neighbours.prev.href} className="btn btn-secondary flex-1 text-[0.875rem]">
              ← {neighbours.prev.label}
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {neighbours.next ? (
            <Link href={neighbours.next.href} className="btn btn-secondary flex-1 text-[0.875rem]">
              {neighbours.next.label} →
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
      )}
    </>
  );
}

const SCALE_SOURCE = {
  reference_object: "Reference",
  stud_spacing: "Framing",
  assumed: "Assumed",
} as const;

function Field({ term, value }: { term: string; value: string }) {
  return (
    <div className="field">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}
