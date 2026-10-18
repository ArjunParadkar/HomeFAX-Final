/**
 * Exact-parts identification layer.
 *
 * This module builds the prompt section that instructs the vision model to
 * identify catalog SKUs precisely — reading labels, nameplates, stamps, and
 * printed markings directly off keyframes — and provides the Zod schema for
 * structured detection output plus a converter from detection to PartLine.
 *
 * Nothing here makes API calls. vision.ts owns the network layer; it embeds
 * the schema and calls buildPartsIdPrompt() to assemble context.
 *
 * Strict identification discipline:
 *   - `identified` fields are populated only when text is legibly readable in a
 *     frame. The model must name the frame it read from.
 *   - If a field is not clearly readable, it is omitted — not inferred or guessed.
 *   - This preserves the property that every `identified` entry in a PartLine
 *     can be traced back to a physical marking in the construction record.
 */

import { z } from "zod";
import { CATALOG } from "./catalog";
import { expectedSkusForStage } from "./catalog";
import type { PartLine, SceneGeometry, StageId } from "./types";

// ─── Zod schema ──────────────────────────────────────────────────────────────

/**
 * Structured detection output from the vision model.
 * Embed this in the vision prompt via zodOutputFormat or equivalent.
 */
export const ExactDetection = z.object({
  sku: z
    .string()
    .describe(
      "Must be one of the catalog SKUs provided in the prompt. Unknown items are omitted — never free-text.",
    ),
  quantity: z
    .number()
    .describe(
      "Count of units actually visible in the provided frames. This is NOT a whole-house estimate; the geometric takeoff handles totals.",
    ),
  confidence: z.number().describe("0 to 1"),
  reasoning: z
    .string()
    .describe(
      "One sentence: where and how the count was made (e.g. 'five register boots visible across frames 2, 4, and 6').",
    ),
  identified: z
    .object({
      manufacturer: z
        .string()
        .optional()
        .describe("Brand name as printed on label or nameplate (e.g. 'Behr', 'Trane', 'Leviton')"),
      model: z
        .string()
        .optional()
        .describe("Model number or product line as printed (e.g. 'N7748', 'Premium Plus Ultra')"),
      color: z
        .string()
        .optional()
        .describe(
          "Color name or code as printed on the label (e.g. 'Agreeable Gray SW 7029', 'PPG1025-3')",
        ),
      finish: z
        .string()
        .optional()
        .describe(
          "Surface description as printed (e.g. 'eggshell', 'semi-gloss', 'flat', 'satin')",
        ),
      size: z
        .string()
        .optional()
        .describe(
          "Dimension stamp or printed size: lumber grade stamp ('2x4 SPF'), wire gauge ('12 AWG'), pipe marking ('2 DWV SCH 40'), can size ('1 GAL')",
        ),
      readFrom: z
        .string()
        .optional()
        .describe("Where the text was read, e.g. 'nameplate in frame 4' or 'paint-can label in frame 1'"),
    })
    .optional()
    .describe(
      "Exact identification read off a legible label, nameplate, stamp, or printed marking. " +
        "Populate ONLY when text is clearly readable. Omit any sub-field that is not legible. " +
        "Do NOT infer, approximate, or fill in from visual appearance alone.",
    ),
});

export type ExactDetectionT = z.infer<typeof ExactDetection>;

// ─── Prompt builder ───────────────────────────────────────────────────────────

const M2_PER_FT2 = 0.092903;

/**
 * Returns a self-contained prompt section instructing the vision model how to
 * count and identify parts at this stage. Designed to be appended to the main
 * inspection context string assembled in vision.ts.
 *
 * @param stage    The construction stage being analyzed.
 * @param geometry Measured scene geometry from the reconstruction (provides
 *                 area context so the model doesn't extrapolate counts).
 */
export function buildPartsIdPrompt(stage: StageId, geometry: SceneGeometry): string {
  const catalog = expectedSkusForStage(stage);
  const wallFt2 = (geometry.wallAreaM2 / M2_PER_FT2).toFixed(0);
  const floorFt2 = (geometry.floorAreaM2 / M2_PER_FT2).toFixed(0);

  const catalogLines = catalog.map((e) => {
    const parts = [`  ${e.sku}: ${e.name}`];
    if (e.spec) parts.push(`(${e.spec})`);
    parts.push(`— counted in ${e.unit}`);
    return parts.join(" ");
  });

  return [
    "═══ PARTS IDENTIFICATION ═══",
    "",
    "COUNT RULES:",
    "- Report only SKUs from the catalog below that are actually visible in the provided frames.",
    "- Count only what you see in these frames. The geometric takeoff handles whole-house totals;",
    "  do not extrapolate beyond what is in-frame.",
    `- Measured context (do not re-count): floor ${floorFt2} sf, wall ${wallFt2} sf.`,
    "- If a catalog item is not visible at all, omit it entirely from your detections.",
    "",
    "EXACT IDENTIFICATION PROTOCOL:",
    "When any label, nameplate, sticker, stamp, or printed marking is legible in a frame,",
    "read and record it under `identified`. Populate only what is clearly readable:",
    "",
    "  manufacturer — brand as printed: 'Behr', 'Trane', 'Leviton', 'Moen', 'Georgia-Pacific'",
    "  model        — model/product number or line as printed: 'N7748', 'Premium Plus Ultra'",
    "  color        — paint color name or code as printed on label: 'Agreeable Gray SW 7029'",
    "  finish       — sheen as printed: 'flat', 'eggshell', 'semi-gloss', 'satin'",
    "  size         — dimension stamp as printed: lumber grade stamp ('2x4 SPF #2'),",
    "                 wire gauge printing ('12 AWG WITH GROUND'), pipe marking ('2 DWV SCH 40')",
    "  readFrom     — source frame: 'nameplate in frame 4', 'paint-can label in frame 1'",
    "",
    "STRICT IDENTIFICATION DISCIPLINE — DO NOT VIOLATE:",
    "- Omit any sub-field you cannot clearly read. Partial identification is correct;",
    "  a guess is a falsification of the construction record.",
    "- Do not infer manufacturer from logo shape, colour, or approximation.",
    "- Do not fill `color` from the paint colour on the wall — read the can label.",
    "- Do not fill `size` from visual estimation — read the printed stamp or marking.",
    "- If nothing is legible, omit `identified` entirely.",
    "",
    "CATALOG FOR THIS STAGE (only these SKUs may appear in detections):",
    ...catalogLines,
    "",
    "═══════════════════════════",
  ].join("\n");
}

// ─── Detection → PartLine ─────────────────────────────────────────────────────

/**
 * Maps a structured vision detection to an orderable PartLine.
 *
 * Returns null for unknown SKUs — the parts list is a real orderable list and
 * must not contain free-text items. The `identified` field is passed through
 * unchanged, preserving the direct chain from physical label to record.
 */
export function detectionToPartLine(d: ExactDetectionT, stage: StageId): PartLine | null {
  const entry = CATALOG[d.sku];
  if (!entry) return null;
  if (d.quantity <= 0) return null;

  const result: PartLine = {
    id: `${stage}:${d.sku}`,
    sku: entry.sku,
    name: entry.name,
    category: entry.category,
    spec: entry.spec,
    quantity: Math.round(d.quantity * 10) / 10,
    unit: entry.unit,
    basis: "detected",
    derivation: d.reasoning,
    confidence: Math.max(0, Math.min(1, d.confidence)),
    unitCostUsd: entry.unitCostUsd,
    stage,
  };

  if (d.identified) {
    result.identified = { ...d.identified };
  }

  return result;
}
