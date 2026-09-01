import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  visionCheckpointPrompt,
  visionCheckpointsForStage,
  type VisionVerdict,
} from "./checkpoints";
import { buildPartsIdPrompt, detectionToPartLine, ExactDetection } from "./parts-id";
import { stageDef } from "./stages";
import type { Finding, PartLine, SceneGeometry, StageId } from "./types";

/**
 * The judged half of the pipeline.
 *
 * Everything here looks at the keyframes the reconstruction actually used, so
 * a finding can always be traced back to a frame the contractor filmed. The
 * measured geometry is handed over as context — it stops the model from
 * guessing at dimensions it cannot see, and lets it reason about quantities
 * against a real scale.
 */

export const visionConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

/** Enough views to judge a room without paying for near-duplicate frames. */
const MAX_FRAMES = 8;

const FindingSchema = z.object({
  severity: z.enum(["info", "minor", "major", "critical"]),
  title: z.string().describe("Six words or fewer, naming the defect"),
  detail: z
    .string()
    .describe(
      "Two sentences: what is visible in the frame, and what it means for the build. Name the frame number.",
    ),
  dimension: z
    .enum(["workmanship", "compliance"])
    .describe(
      "workmanship for execution quality; compliance for code or specification requirements",
    ),
  frameIndex: z.number().describe("Zero-based index of the frame this was seen in"),
});

const CheckpointVerdictSchema = z.object({
  id: z.string().describe("The checkpoint id exactly as given, e.g. QC-19"),
  status: z.enum(["pass", "attention", "fail", "not_assessable"]),
  evidence: z
    .string()
    .describe("One line naming what is visible and the frame number it is in; for not_assessable, why it could not be judged"),
  frameIndex: z
    .number()
    .nullable()
    .describe("Zero-based frame index the evidence is in, or null for not_assessable"),
});

const ReportSchema = z.object({
  stageConfirmed: z
    .boolean()
    .describe("Whether the frames actually show the construction stage claimed"),
  summary: z.string().describe("Two sentences a homeowner would understand"),
  findings: z.array(FindingSchema),
  detections: z.array(ExactDetection),
  checkpoints: z
    .array(CheckpointVerdictSchema)
    .describe("One verdict for every 50-point checkpoint id listed in the instructions — no more, no fewer"),
});

export type VisionReport = {
  available: boolean;
  stageConfirmed: boolean;
  summary: string;
  findings: Finding[];
  parts: PartLine[];
  /** Verdicts for this stage's judged 50-point checkpoints. */
  checkpointVerdicts: VisionVerdict[];
  /** Set when vision ran but could not be used, so the UI can say why. */
  unavailableReason?: string;
};

const SYSTEM = `You are a construction inspector reviewing frames pulled from a contractor's site walkthrough. A 3D reconstruction has already measured the geometry; you are judging what only a human eye can judge.

Rules you do not break:
- Report only what is visible in the frames. If a checklist item cannot be assessed from these frames, say nothing about it — silence is correct, a guess is not.
- Every finding names the frame it came from.
- Do not repeat findings that the measured geometry already covers (plumb, level, flatness, stud spacing). Those are handled elsewhere and duplicating them double-counts against the contractor.
- Count parts you can actually see in these frames. Do not extrapolate to the rest of the house; the geometric takeoff handles totals.
- Only use SKUs from the catalogue given to you. If something is visible but not in the catalogue, leave it out.
- Severity: critical means unsafe or must be torn out; major means it will fail inspection; minor is a workmanship note; info is context worth recording.`;

export async function analyzeStage(args: {
  stage: StageId;
  keyframeUrls: string[];
  geometry: SceneGeometry;
}): Promise<VisionReport> {
  const empty: VisionReport = {
    available: false,
    stageConfirmed: false,
    summary: "",
    findings: [],
    parts: [],
    checkpointVerdicts: [],
  };

  if (!visionConfigured) {
    return { ...empty, unavailableReason: "ANTHROPIC_API_KEY is not configured." };
  }
  if (args.keyframeUrls.length === 0) {
    return {
      ...empty,
      unavailableReason:
        "The reconstruction returned no keyframes, so there was nothing to inspect visually.",
    };
  }

  const def = stageDef(args.stage);
  const frames = pickSpread(args.keyframeUrls, MAX_FRAMES);

  const client = new Anthropic();

  const context = [
    `Stage: ${def.label} — ${def.blurb}`,
    "",
    "Inspection checklist for this stage:",
    ...def.checklist.map((c, i) => `${i + 1}. ${c}`),
    "",
    buildPartsIdPrompt(args.stage, args.geometry),
    "",
    "Already measured from the 3D model (do not re-report these):",
    `- Floor area ${args.geometry.floorAreaM2.toFixed(1)} m², wall area ${args.geometry.wallAreaM2.toFixed(1)} m²`,
    args.geometry.ceilingHeightM
      ? `- Ceiling height ${args.geometry.ceilingHeightM.toFixed(2)} m`
      : "- Ceiling height could not be measured",
    args.geometry.studSpacingIn != null
      ? `- Stud spacing ${args.geometry.studSpacingIn.toFixed(1)} in on centre`
      : "- No repeating framing members detected",
    "",
    visionCheckpointPrompt(args.stage),
    "",
    `${frames.length} frames follow, indexed from 0 in the order shown.`,
  ].join("\n");

  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 8000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(ReportSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: context },
            ...frames.map((url) => ({
              type: "image" as const,
              source: { type: "url" as const, url },
            })),
          ],
        },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      return {
        ...empty,
        unavailableReason: "The vision grader returned a response that could not be parsed.",
      };
    }

    const findings: Finding[] = parsed.findings.map((f, i) => ({
      id: `vision-${args.stage}-${i}`,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      dimension: f.dimension,
      source: "vision",
      keyframeIndex: f.frameIndex,
    }));

    const parts = parsed.detections
      .map((d) => detectionToPartLine(d, args.stage))
      .filter((p): p is PartLine => p !== null);

    // Only verdicts for ids this stage actually asked about; anything else the
    // model invented is dropped rather than trusted.
    const askedIds = new Set(visionCheckpointsForStage(args.stage).map((c) => c.id));
    const checkpointVerdicts: VisionVerdict[] = parsed.checkpoints
      .filter((c) => askedIds.has(c.id))
      .map((c) => ({
        id: c.id,
        status: c.status,
        evidence: c.evidence,
        frameIndex: c.frameIndex ?? undefined,
      }));

    return {
      available: true,
      stageConfirmed: parsed.stageConfirmed,
      summary: parsed.summary,
      findings,
      parts,
      checkpointVerdicts,
    };
  } catch (err) {
    // A grading failure must never sink a reconstruction that already succeeded.
    const message = err instanceof Error ? err.message : String(err);
    return { ...empty, unavailableReason: `Vision grading failed: ${message}` };
  }
}

/** Evenly spaced sample, so the frames span the whole walk rather than its first seconds. */
function pickSpread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = (items.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => items[Math.round(i * step)]);
}
