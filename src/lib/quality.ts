import { stageDef } from "./stages";
import type {
  DimensionScore,
  Finding,
  QualityDimension,
  QualityReport,
  ReconResult,
  StageId,
} from "./types";

/**
 * Grading has two halves that are deliberately kept apart.
 *
 * `capture` and `geometry` are measured: they come off the reconstruction and
 * are reproducible from the same video every time. `workmanship` and
 * `compliance` are judged by a vision model against the stage checklist, and
 * are only as good as the frames it was shown.
 *
 * When vision is unavailable the report says so and redistributes the weight
 * onto the measured half rather than silently inventing a number.
 */

/** Below this, the solve is too loose to make claims about the geometry. */
const REPROJ_ERROR_CEILING_PX = 2.5;
/** Laplacian variance below this reads as motion blur on a phone camera. */
const SHARPNESS_FLOOR = 60;
/** Nominal residential stud spacing, inches. */
const NOMINAL_STUD_SPACING_IN = 16;
/** A wall more than this far off plumb is worth flagging. */
const PLUMB_TOLERANCE_DEG = 1.5;
/** Framing flatness a straightedge would catch, in mm. */
const FLATNESS_TOLERANCE_MM = 6;

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Maps a value to 0-100, full marks at `best`, zero at `worst`. Handles either direction. */
function ramp(value: number, best: number, worst: number): number {
  if (best === worst) return 100;
  const t = (value - worst) / (best - worst);
  return clamp(t * 100);
}

/**
 * Capture quality: did the contractor actually film enough, steadily enough,
 * for the rest of the pipeline to mean anything?
 */
export function scoreCapture(recon: ReconResult): {
  score: number;
  basis: string;
  findings: Finding[];
} {
  const m = recon.metrics;
  const findings: Finding[] = [];

  const registration = m.framesSubmitted > 0 ? m.framesRegistered / m.framesSubmitted : 0;
  const registrationScore = ramp(registration, 0.95, 0.5);
  const sharpnessScore = ramp(m.sharpness, SHARPNESS_FLOOR * 3, SHARPNESS_FLOOR * 0.5);
  const completenessScore = ramp(m.meshCompleteness, 0.9, 0.4);

  if (registration < 0.75) {
    findings.push({
      id: "capture-registration",
      severity: registration < 0.5 ? "major" : "minor",
      title: "Parts of the walk did not solve",
      detail:
        `Only ${m.framesRegistered} of ${m.framesSubmitted} frames registered. ` +
        "That usually means the camera moved too fast, or a stretch of blank wall gave the solver nothing to track. Re-film those runs slower.",
      dimension: "capture",
      source: "capture",
    });
  }
  if (m.sharpness < SHARPNESS_FLOOR) {
    findings.push({
      id: "capture-blur",
      severity: "minor",
      title: "Frames are soft",
      detail:
        "Median frame sharpness is below what the detail checks need. Walk at half speed and let the phone settle at each corner.",
      dimension: "capture",
      source: "capture",
    });
  }
  if (m.meshCompleteness < 0.6) {
    findings.push({
      id: "capture-holes",
      severity: "minor",
      title: "The model has holes",
      detail:
        `${Math.round((1 - m.meshCompleteness) * 100)}% of the surface came back open. ` +
        "Areas you only saw from one angle cannot be reconstructed — give every surface two passes from different positions.",
      dimension: "capture",
      source: "capture",
    });
  }

  const score = registrationScore * 0.5 + sharpnessScore * 0.2 + completenessScore * 0.3;
  return {
    score: clamp(score),
    basis: `${m.framesRegistered}/${m.framesSubmitted} frames solved, ${Math.round(
      m.meshCompleteness * 100,
    )}% closed surface`,
    findings,
  };
}

/**
 * Geometry quality: measured off the mesh. Plumb walls, level floors, and — where
 * framing is exposed — regular stud spacing.
 */
export function scoreGeometry(
  recon: ReconResult,
  stage: StageId,
): { score: number; basis: string; findings: Finding[] } {
  const def = stageDef(stage);
  const g = recon.geometry;
  const findings: Finding[] = [];

  const solveScore = ramp(recon.metrics.reprojectionErrorPx, 0.6, REPROJ_ERROR_CEILING_PX);

  const walls = g.planes.filter((p) => p.kind === "wall");
  const floors = g.planes.filter((p) => p.kind === "floor" || p.kind === "ceiling");

  // Area-weighted, so a badly out-of-plumb closet wall does not outvote the great room.
  const weightedDeviation = (planes: typeof g.planes) => {
    const area = planes.reduce((a, p) => a + p.areaM2, 0);
    if (area === 0) return null;
    return planes.reduce((a, p) => a + p.deviationDeg * p.areaM2, 0) / area;
  };

  const wallDev = weightedDeviation(walls);
  const floorDev = weightedDeviation(floors);
  const plumbScore = wallDev === null ? null : ramp(wallDev, 0.2, PLUMB_TOLERANCE_DEG * 2);
  const levelScore = floorDev === null ? null : ramp(floorDev, 0.2, PLUMB_TOLERANCE_DEG * 2);

  for (const p of walls) {
    if (p.deviationDeg > PLUMB_TOLERANCE_DEG && p.areaM2 > 2) {
      findings.push({
        id: `geometry-plumb-${Math.round(p.areaM2 * 10)}`,
        severity: p.deviationDeg > 3 ? "major" : "minor",
        title: `Wall is ${p.deviationDeg.toFixed(1)}° out of plumb`,
        detail: `A ${p.areaM2.toFixed(1)} m² wall face leans ${p.deviationDeg.toFixed(
          1,
        )}° off vertical — about ${(Math.tan((p.deviationDeg * Math.PI) / 180) * 2440).toFixed(
          0,
        )} mm of drift over a standard wall height.`,
        dimension: "geometry",
        source: "geometry",
      });
    }
    if (p.flatnessMm > FLATNESS_TOLERANCE_MM && p.areaM2 > 2) {
      findings.push({
        id: `geometry-flat-${Math.round(p.areaM2 * 10)}`,
        severity: "minor",
        title: "Wall plane is bowed",
        detail: `Surface deviates ${p.flatnessMm.toFixed(
          0,
        )} mm RMS from a true plane — a crowned stud or a proud sheet edge would read like this.`,
        dimension: "geometry",
        source: "geometry",
      });
    }
  }

  // Stud spacing is only meaningful while the framing is open.
  let spacingScore: number | null = null;
  if (def.exposedFraming && g.studSpacingIn != null) {
    const offNominal = Math.abs(g.studSpacingIn - NOMINAL_STUD_SPACING_IN);
    const nearest = [12, 16, 19.2, 24].reduce((a, b) =>
      Math.abs(b - g.studSpacingIn!) < Math.abs(a - g.studSpacingIn!) ? b : a,
    );
    const offNearest = Math.abs(g.studSpacingIn - nearest);
    // Consistency matters more than which nominal spacing was chosen.
    const cv = g.studSpacingCv ?? 0;
    spacingScore = ramp(cv, 0.02, 0.15) * 0.7 + ramp(offNearest, 0.25, 2) * 0.3;
    if (cv > 0.08) {
      findings.push({
        id: "geometry-spacing",
        severity: "major",
        title: "Stud spacing is irregular",
        detail: `Measured spacing averages ${g.studSpacingIn.toFixed(
          1,
        )}in but varies ${(cv * 100).toFixed(0)}% bay to bay. Sheathing and drywall edges will not land on centres.`,
        dimension: "geometry",
        source: "geometry",
      });
    }
    if (offNominal > 2 && offNearest > 1) {
      findings.push({
        id: "geometry-spacing-nominal",
        severity: "minor",
        title: `Spacing of ${g.studSpacingIn.toFixed(1)}in is off-standard`,
        detail: "Not close to 12, 16, 19.2, or 24 on centre — worth confirming against the plan set.",
        dimension: "geometry",
        source: "geometry",
      });
    }
  }

  const parts = [
    { v: solveScore, w: 0.25 },
    { v: plumbScore, w: 0.3 },
    { v: levelScore, w: 0.2 },
    { v: spacingScore, w: 0.25 },
  ].filter((p): p is { v: number; w: number } => p.v !== null);
  const totalW = parts.reduce((a, p) => a + p.w, 0);
  const score = totalW === 0 ? 0 : parts.reduce((a, p) => a + p.v * p.w, 0) / totalW;

  const basisBits = [`${recon.metrics.reprojectionErrorPx.toFixed(2)}px solve`];
  if (wallDev !== null) basisBits.push(`${wallDev.toFixed(2)}° mean plumb`);
  if (g.studSpacingIn != null) basisBits.push(`${g.studSpacingIn.toFixed(1)}in OC`);

  return { score: clamp(score), basis: basisBits.join(", "), findings };
}

/** Severity → how many points it costs the dimension it landed on. */
const SEVERITY_PENALTY: Record<Finding["severity"], number> = {
  info: 0,
  minor: 6,
  major: 16,
  critical: 34,
};

/**
 * Turns vision findings into a 0-100 for a dimension: start at full marks and
 * deduct per finding, so a clean stage scores 100 and each real problem costs
 * a defensible, fixed amount.
 */
export function scoreFromFindings(findings: Finding[], dimension: QualityDimension): number {
  const relevant = findings.filter((f) => f.dimension === dimension);
  const penalty = relevant.reduce((a, f) => a + SEVERITY_PENALTY[f.severity], 0);
  return clamp(100 - penalty);
}

export function toGrade(score: number): QualityReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Assembles the stage report. `visionFindings` come from the vision grader and
 * may be empty — see the note at the top of this file for what that costs.
 */
export function buildQualityReport(
  recon: ReconResult,
  stage: StageId,
  visionFindings: Finding[],
  vision: {
    status: NonNullable<QualityReport["visionStatus"]>;
    note?: string;
  },
): QualityReport {
  // Only a review that actually assessed this stage may score it. A review that
  // ran but found the wrong subject would otherwise score a perfect 100 for
  // workmanship, because there were no defects to deduct for.
  const visionAvailable = vision.status === "graded";
  const def = stageDef(stage);
  const capture = scoreCapture(recon);
  const geometry = scoreGeometry(recon, stage);

  const findings = [...capture.findings, ...geometry.findings, ...visionFindings];

  const raw: DimensionScore[] = [
    {
      dimension: "capture",
      score: capture.score,
      weight: def.weights.capture,
      basis: capture.basis,
    },
    {
      dimension: "geometry",
      score: geometry.score,
      weight: def.weights.geometry,
      basis: geometry.basis,
    },
    {
      dimension: "workmanship",
      score: scoreFromFindings(findings, "workmanship"),
      weight: def.weights.workmanship,
      basis: visionAvailable
        ? `${findings.filter((f) => f.dimension === "workmanship").length} findings against ${
            def.checklist.length
          } checklist items`
        : "not assessed",
    },
    {
      dimension: "compliance",
      score: scoreFromFindings(findings, "compliance"),
      weight: def.weights.compliance,
      basis: visionAvailable
        ? `${findings.filter((f) => f.dimension === "compliance").length} findings against ${
            def.checklist.length
          } checklist items`
        : "not assessed",
    },
  ];

  // Without vision, drop those dimensions and renormalise rather than scoring them 100.
  const active = visionAvailable
    ? raw
    : raw.filter((d) => d.dimension === "capture" || d.dimension === "geometry");
  const totalWeight = active.reduce((a, d) => a + d.weight, 0);
  const dimensions = active.map((d) => ({ ...d, weight: d.weight / totalWeight }));

  const score = dimensions.reduce((a, d) => a + d.score * d.weight, 0);

  const order: Record<Finding["severity"], number> = { critical: 0, major: 1, minor: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    score: Math.round(score),
    grade: toGrade(score),
    dimensions,
    findings,
    visionAvailable,
    visionStatus: vision.status,
    visionNote: vision.note,
  };
}
