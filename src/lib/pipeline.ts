import { cumulativeParts, takeoffFromGeometry } from "./parts";
import { buildQualityReport } from "./quality";
import { pollRecon } from "./recon";
import { getCapture, updateCapture, type CaptureRow } from "./store";
import { analyzeStage } from "./vision";
import type { StageId } from "./types";

/**
 * Advances one capture as far as it can go, then persists.
 *
 * The client polls this; it is deliberately idempotent. Reconstruction runs on
 * a GPU worker, and the analysis that follows (vision grading, scoring, parts)
 * runs here exactly once — the first poll that sees a finished reconstruction
 * does the work and writes the result, and every later poll just reads it back.
 */
export async function advanceCapture(id: string): Promise<CaptureRow | null> {
  const capture = await getCapture(id);
  if (!capture) return null;
  if (capture.state === "done" || capture.state === "failed") return capture;
  if (!capture.jobId) return capture;

  let job;
  try {
    job = await pollRecon(capture.jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCapture(id, {
      state: "failed",
      job: {
        id: capture.jobId,
        state: "failed",
        steps: [],
        error: message,
      },
    });
    return getCapture(id);
  }

  if (job.state === "failed") {
    await updateCapture(id, { state: "failed", job });
    return getCapture(id);
  }

  if (job.state !== "done" || !job.result) {
    await updateCapture(id, { state: job.state, job });
    return getCapture(id);
  }

  // Reconstruction landed. Grade it, take off the parts, and store everything.
  const stage = capture.stage as StageId;
  const vision = await analyzeStage({
    stage,
    keyframeUrls: job.result.keyframeUrls,
    geometry: job.result.geometry,
  });

  const quality = buildQualityReport(job.result, stage, vision.findings, vision.available);
  const geometryParts = takeoffFromGeometry(job.result, stage);
  // One list per stage: measured quantities plus anything the review counted.
  const parts = cumulativeParts([{ stage, parts: [...geometryParts, ...vision.parts] }]);

  await updateCapture(id, {
    state: "done",
    job,
    glbUrl: job.result.glbUrl,
    quality,
    parts,
    score: quality.score,
    notes: vision.available ? vision.summary : (vision.unavailableReason ?? null),
  });

  return getCapture(id);
}
