import type { JobStep, ReconJob, ReconResult, StageId } from "./types";

/**
 * Client for the reconstruction worker.
 *
 * In production this is a RunPod serverless endpoint (see services/recon) that
 * bills per second and scales to zero. When RUNPOD_ENDPOINT_ID is absent the
 * module falls back to a local simulation so the whole app — upload, timeline,
 * grading, parts — is still walkable. Simulated jobs are flagged everywhere
 * they surface; they are never presented as a real reconstruction.
 */

export const reconConfigured = Boolean(
  process.env.RUNPOD_ENDPOINT_ID && process.env.RUNPOD_API_KEY,
);

const STEP_TEMPLATE: { key: string; label: string }[] = [
  { key: "extract", label: "Selecting keyframes" },
  { key: "features", label: "Matching features" },
  { key: "sfm", label: "Solving camera poses" },
  { key: "dense", label: "Dense stereo" },
  { key: "mesh", label: "Meshing and texturing" },
  { key: "measure", label: "Measuring geometry" },
  { key: "pack", label: "Compressing model" },
];

export type ReconRequest = {
  videoUrl?: string;
  imageUrls?: string[];
  stage: StageId;
  maxFrames?: number;
};

function endpoint(path: string): string {
  return `https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID}/${path}`;
}

export async function submitRecon(req: ReconRequest): Promise<string> {
  if (!reconConfigured) return `demo-${Date.now()}-${req.stage}`;

  const res = await fetch(endpoint("run"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        video_url: req.videoUrl,
        image_urls: req.imageUrls,
        stage: req.stage,
        max_frames: req.maxFrames ?? 90,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`RunPod rejected the job (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string; error?: string };
  if (!body.id) throw new Error(body.error ?? "RunPod returned no job id");
  return body.id;
}

type RunpodStatus = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: unknown;
  error?: string;
};

export async function pollRecon(jobId: string): Promise<ReconJob> {
  if (jobId.startsWith("demo-")) return simulate(jobId);

  const res = await fetch(endpoint(`status/${jobId}`), {
    headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`RunPod status check failed (${res.status})`);
  }
  const body = (await res.json()) as RunpodStatus;

  if (body.status === "IN_QUEUE") {
    return { id: jobId, state: "queued", steps: stepsFrom(null) };
  }
  if (body.status === "IN_PROGRESS") {
    // The worker publishes progress through runpod.serverless.progress_update,
    // which arrives here as `output` while the job is still running.
    const progress = body.output as { step?: string; detail?: string } | undefined;
    return {
      id: jobId,
      state: stateForStep(progress?.step),
      steps: stepsFrom(progress?.step ?? null, progress?.detail),
    };
  }
  if (body.status === "COMPLETED") {
    const out = body.output as { ok?: boolean; error?: string; result?: ReconResult } | undefined;
    if (!out?.ok || !out.result) {
      return {
        id: jobId,
        state: "failed",
        steps: stepsFrom(null),
        error: out?.error ?? "The worker finished without producing a model.",
      };
    }
    return {
      id: jobId,
      state: "done",
      steps: STEP_TEMPLATE.map((s) => ({ ...s, state: "done" as const })),
      result: out.result,
    };
  }
  return {
    id: jobId,
    state: "failed",
    steps: stepsFrom(null),
    error: body.error ?? `Job ended as ${body.status}.`,
  };
}

function stateForStep(step?: string): ReconJob["state"] {
  switch (step) {
    case "extract":
      return "extracting";
    case "features":
    case "sfm":
      return "registering";
    case "dense":
      return "reconstructing";
    case "mesh":
    case "pack":
      return "meshing";
    case "measure":
      return "analyzing";
    default:
      return "queued";
  }
}

function stepsFrom(current: string | null, detail?: string): JobStep[] {
  const idx = current ? STEP_TEMPLATE.findIndex((s) => s.key === current) : -1;
  return STEP_TEMPLATE.map((s, i) => ({
    ...s,
    state: idx < 0 ? "pending" : i < idx ? "done" : i === idx ? "running" : "pending",
    detail: i === idx ? detail : undefined,
  }));
}

/* ------------------------------------------------------------------ */
/* Simulation — only reachable when no RunPod endpoint is configured.  */
/* ------------------------------------------------------------------ */

/** Deterministic per-job noise so a simulated record does not change on refresh. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIM_SECONDS = 24;

function simulate(jobId: string): ReconJob {
  const startedAt = Number(jobId.split("-")[1] ?? Date.now());
  const stage = (jobId.split("-").slice(2).join("-") || "framing") as StageId;
  const elapsed = (Date.now() - startedAt) / 1000;
  const rand = seeded(jobId);

  if (elapsed < SIM_SECONDS) {
    const idx = Math.min(
      STEP_TEMPLATE.length - 1,
      Math.floor((elapsed / SIM_SECONDS) * STEP_TEMPLATE.length),
    );
    return {
      id: jobId,
      state: stateForStep(STEP_TEMPLATE[idx].key),
      steps: stepsFrom(STEP_TEMPLATE[idx].key, "simulated"),
    };
  }

  const framesSubmitted = 64;
  const framesRegistered = Math.round(framesSubmitted * (0.82 + rand() * 0.16));
  const spacing = 16 + (rand() - 0.5) * 1.6;
  const result: ReconResult = {
    glbUrl: "procedural://framed-room",
    keyframeUrls: [],
    metrics: {
      framesRegistered,
      framesSubmitted,
      reprojectionErrorPx: 0.7 + rand() * 0.8,
      pointCount: 1_400_000 + Math.floor(rand() * 900_000),
      triangleCount: 180_000 + Math.floor(rand() * 60_000),
      meshCompleteness: 0.62 + rand() * 0.3,
      sharpness: 70 + rand() * 120,
      metresPerUnit: 1,
      scaleSource: "stud_spacing",
      glbBytes: 2_900_000 + Math.floor(rand() * 900_000),
    },
    geometry: {
      boundingBoxM: [7.9, 2.6, 6.1],
      floorAreaM2: 44 + rand() * 10,
      wallAreaM2: 88 + rand() * 18,
      ceilingHeightM: 2.44,
      planes: [
        { kind: "floor", areaM2: 46, deviationDeg: 0.3 + rand() * 0.4, flatnessMm: 3 + rand() * 3 },
        { kind: "wall", areaM2: 21, deviationDeg: 0.4 + rand() * 0.6, flatnessMm: 4 + rand() * 3 },
        { kind: "wall", areaM2: 19, deviationDeg: 0.9 + rand() * 1.8, flatnessMm: 5 + rand() * 4 },
        { kind: "wall", areaM2: 17, deviationDeg: 0.5 + rand() * 0.7, flatnessMm: 4 + rand() * 3 },
        { kind: "ceiling", areaM2: 44, deviationDeg: 0.4 + rand() * 0.5, flatnessMm: 5 + rand() * 4 },
      ],
      studSpacingIn: stage === "drywall" || stage === "finishes" ? null : spacing,
      studSpacingCv: stage === "drywall" || stage === "finishes" ? null : 0.03 + rand() * 0.09,
    },
  };

  return {
    id: jobId,
    state: "done",
    steps: STEP_TEMPLATE.map((s) => ({ ...s, state: "done" as const })),
    result,
  };
}
