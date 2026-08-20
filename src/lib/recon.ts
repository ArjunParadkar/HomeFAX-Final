import type { JobStep, ReconJob, ReconResult, StageId } from "./types";

/**
 * Client for the reconstruction worker, in three flavours.
 *
 *   serverless — a RunPod serverless endpoint. Bills per second, scales to
 *                zero, and is the right shape for bursty contractor traffic.
 *   pod        — a rented RunPod Pod running services/recon/app/server.py.
 *                Bills by the hour whether or not anyone films anything, but
 *                it is warm, so there is no cold start on the first stage.
 *   demo       — neither is configured. Everything else in the app still runs,
 *                and every surface says the geometry is simulated.
 *
 * Both real modes drive the identical pipeline; only the transport differs.
 */

export type ReconMode = "serverless" | "pod" | "demo";

export function reconMode(): ReconMode {
  if (process.env.RUNPOD_ENDPOINT_ID && process.env.RUNPOD_API_KEY) return "serverless";
  if (process.env.RECON_URL && process.env.RECON_KEY) return "pod";
  return "demo";
}

export const reconConfigured = reconMode() !== "demo";

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

function podUrl(path: string): string {
  return `${(process.env.RECON_URL ?? "").replace(/\/$/, "")}/${path}`;
}

export async function submitRecon(req: ReconRequest): Promise<string> {
  const mode = reconMode();
  if (mode === "demo") return `demo-${Date.now()}-${req.stage}`;

  const input = {
    video_url: req.videoUrl,
    image_urls: req.imageUrls,
    stage: req.stage,
    max_frames: req.maxFrames ?? 90,
  };

  const [url, token] =
    mode === "serverless"
      ? [endpoint("run"), process.env.RUNPOD_API_KEY!]
      : [podUrl("reconstruct"), process.env.RECON_KEY!];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    throw new Error(`The reconstruction worker rejected the job (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string; error?: string };
  if (!body.id) throw new Error(body.error ?? "The worker returned no job id.");
  // Pod job ids are opaque hex; tagging them keeps polling unambiguous when a
  // deployment switches modes with jobs already in flight.
  return mode === "pod" ? `pod:${body.id}` : body.id;
}

type RunpodStatus = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: unknown;
  error?: string;
  /** Pod mode reports the running step outside `output`. */
  step?: string;
  detail?: string;
};

export async function pollRecon(jobId: string): Promise<ReconJob> {
  if (jobId.startsWith("demo-")) return simulate(jobId);

  const isPod = jobId.startsWith("pod:");
  const id = isPod ? jobId.slice(4) : jobId;

  const [url, token] = isPod
    ? [podUrl(`jobs/${id}`), process.env.RECON_KEY!]
    : [endpoint(`status/${id}`), process.env.RUNPOD_API_KEY!];

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Status check failed (${res.status})`);
  }
  const body = (await res.json()) as RunpodStatus;

  if (body.status === "IN_QUEUE") {
    return { id: jobId, state: "queued", steps: stepsFrom(null) };
  }
  if (body.status === "IN_PROGRESS") {
    // Serverless surfaces progress through `output` while the job runs;
    // the pod reports it at the top level. Accept either.
    const nested = body.output as { step?: string; detail?: string } | undefined;
    const step = body.step ?? nested?.step;
    const detail = body.detail ?? nested?.detail;
    return {
      id: jobId,
      state: stateForStep(step),
      steps: stepsFrom(step ?? null, detail),
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
