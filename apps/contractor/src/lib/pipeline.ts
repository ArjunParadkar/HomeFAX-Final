import {
  analyzeStage,
  buildQualityReport,
  cumulativeParts,
  evaluateCheckpoints,
  pollRecon,
  takeoffFromGeometry,
} from "@homefax/core";
import type { ReconJob } from "@homefax/core";
import { records, withService, type Capture } from "@homefax/db";

/**
 * Advances one capture as far as it can go, then persists.
 *
 * The client polls this; it is deliberately idempotent. Reconstruction runs on
 * a GPU worker, and the analysis that follows (vision grading, scoring, parts)
 * runs here exactly once — the first poll that sees a finished reconstruction
 * does the work and writes the result, and every later poll just reads it back.
 *
 * This is the reconstruction pipeline, one of the named service-level flows:
 * the API route has already checked `canBuild` as the actor before calling.
 */
export async function advanceCapture(id: string): Promise<Capture | null> {
  const capture = await withService((tx) => records.getCapture(tx, id));
  if (!capture) return null;
  if (capture.state === "done" || capture.state === "failed") return capture;
  if (!capture.jobId) return capture;

  let job: ReconJob;
  try {
    job = await pollRecon(capture.jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: ReconJob = { id: capture.jobId, state: "failed", steps: [], error: message };
    await withService((tx) => records.failCapture(tx, id, failed));
    return withService((tx) => records.getCapture(tx, id));
  }

  if (job.state === "failed") {
    await withService((tx) => records.failCapture(tx, id, job));
    return withService((tx) => records.getCapture(tx, id));
  }

  if (job.state !== "done" || !job.result) {
    await withService((tx) => records.updateCapture(tx, id, { state: job.state, job }));
    return withService((tx) => records.getCapture(tx, id));
  }

  // Reconstruction landed. Grade it, take off the parts, and store everything.
  const stage = capture.stage;
  const result = job.result;
  // A simulated run returns no keyframes of its own, but the phone's frames are
  // real and already stored — grade those rather than skipping the review.
  const keyframeUrls = result.keyframeUrls.length > 0 ? result.keyframeUrls : capture.frames;

  const vision = await analyzeStage({ stage, keyframeUrls, geometry: result.geometry });

  // A review that ran but found the wrong subject is not a pass — it is an
  // unscored stage, and the record says which.
  const status = !vision.available ? "unavailable" : vision.stageConfirmed ? "graded" : "stage_not_shown";
  const note =
    status === "unavailable"
      ? vision.unavailableReason
      : status === "stage_not_shown"
        ? "The footage does not show this construction stage, so workmanship and compliance were not scored."
        : undefined;

  // The 50-point ledger: measured points verdict off the reconstruction, the
  // judged points off the review — and only a review that confirmed the stage
  // may supply verdicts, otherwise every judged point reads not_assessable.
  const ledger = evaluateCheckpoints(
    result,
    stage,
    status === "graded" ? vision.checkpointVerdicts : [],
    status === "graded" ? undefined : (note ?? "visual review unavailable"),
  );

  const quality = buildQualityReport(result, stage, vision.findings, { status, note }, ledger);
  const geometryParts = takeoffFromGeometry(result, stage);
  // One list per stage: measured quantities plus anything the review counted.
  const parts = cumulativeParts([{ stage, parts: [...geometryParts, ...vision.parts] }]);

  return withService((tx) =>
    records.finalizeCapture(tx, id, {
      job,
      glbUrl: result.glbUrl,
      quality,
      parts,
      notes: vision.available ? vision.summary : (vision.unavailableReason ?? null),
    }),
  );
}
