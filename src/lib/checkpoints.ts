import { stageDef } from "./stages";
import type {
  CheckpointCategory,
  CheckpointResult,
  CheckpointStatus,
  ReconResult,
  StageId,
} from "./types";

/**
 * The HomeFAX 50-point assessment.
 *
 * One fixed ledger of fifty named checkpoints covers the whole build. Every
 * stage evaluates the subset that is actually visible at that stage, three
 * ways:
 *
 *   capture/geometry — evaluated deterministically here, off the numbers the
 *                      reconstruction measured. Same video, same verdict.
 *   vision           — judged by the vision grader against the frames; the
 *                      grader returns a verdict per checkpoint id and we take
 *                      it verbatim. No verdict means "not_assessable", never
 *                      a silent pass.
 *
 * Each checkpoint names the best practice it checks (`standard`) and what
 * failing it costs the building over its life (`longevity`) — the ledger is
 * the part of the report a homeowner can read in ten years and still use.
 *
 * The ledger does not re-score the stage: findings drive the 0-100 score, and
 * the deterministic checkpoints share thresholds with the findings in
 * quality.ts, so the two views agree by construction.
 */

export type CheckpointDef = {
  id: string;
  num: number;
  title: string;
  category: CheckpointCategory;
  /** The best practice or code expectation, one line. */
  standard: string;
  /** What failing this costs the building over its life, one line. */
  longevity: string;
  /** Stages at which this point is visible enough to judge. */
  stages: StageId[];
  /** Who produces the verdict. */
  source: "capture" | "geometry" | "vision";
};

/* Shared thresholds — keep in step with quality.ts. */
const REPROJ_ERROR_CEILING_PX = 2.5;
const SHARPNESS_FLOOR = 60;
const PLUMB_TOLERANCE_DEG = 1.5;
const FLATNESS_TOLERANCE_MM = 6;

const ALL_STAGES: StageId[] = [
  "site",
  "foundation",
  "framing",
  "roofing",
  "rough_plumbing",
  "rough_electrical",
  "hvac",
  "insulation",
  "drywall",
  "finishes",
  "final",
];

/** Stages where wall/floor planes exist to measure. */
const PLANE_STAGES: StageId[] = [
  "foundation",
  "framing",
  "roofing",
  "rough_plumbing",
  "rough_electrical",
  "hvac",
  "insulation",
  "drywall",
  "finishes",
  "final",
];

const FRAMING_OPEN: StageId[] = [
  "framing",
  "roofing",
  "rough_plumbing",
  "rough_electrical",
  "hvac",
  "insulation",
];

const d = (
  num: number,
  title: string,
  category: CheckpointCategory,
  source: CheckpointDef["source"],
  stages: StageId[],
  standard: string,
  longevity: string,
): CheckpointDef => ({
  id: `QC-${String(num).padStart(2, "0")}`,
  num,
  title,
  category,
  source,
  stages,
  standard,
  longevity,
});

export const CHECKPOINTS: CheckpointDef[] = [
  // ——— Capture integrity (the record itself has to be trustworthy) ———
  d(1, "Walkthrough fully solved", "capture", "capture", ALL_STAGES,
    "At least three quarters of submitted frames register in the photogrammetry solve",
    "Unsolved stretches are holes in the permanent record — whatever was there is unverifiable later"),
  d(2, "Frames sharp enough to judge", "capture", "capture", ALL_STAGES,
    "Median frame sharpness above the motion-blur floor for detail inspection",
    "Soft frames hide hairline defects that only get expensive once they are buried"),
  d(3, "Surfaces covered from two angles", "capture", "capture", ALL_STAGES,
    "Reconstructed surface at least 60% watertight — every face seen from more than one position",
    "A one-sided pass cannot be measured; missing geometry is missing evidence"),
  d(4, "Real-world scale locked", "capture", "capture", ALL_STAGES,
    "Scale fixed by a reference object or detected framing, not assumed",
    "An assumed scale quietly skews every measured quantity and dimension downstream"),
  d(5, "Solve within survey tolerance", "capture", "geometry", ALL_STAGES,
    `Mean reprojection error under ${REPROJ_ERROR_CEILING_PX}px`,
    "A loose solve turns millimetre claims about plumb and flat into guesswork"),

  // ——— Structure ———
  d(6, "Walls plumb", "structure", "geometry", PLANE_STAGES,
    `Area-weighted wall lean within ${PLUMB_TOLERANCE_DEG}° of true vertical (≈ 1/4in in 8ft)`,
    "Out-of-plumb walls telegraph into every later trade: cabinets, doors, and tile all fight it forever"),
  d(7, "Floors and ceilings level", "structure", "geometry", PLANE_STAGES,
    `Area-weighted floor/ceiling deviation within ${PLUMB_TOLERANCE_DEG}° of true horizontal`,
    "An off-level deck means grout lines, trim reveals, and appliance fits never come right"),
  d(8, "Wall planes flat", "structure", "geometry", PLANE_STAGES,
    `Surface within ${FLATNESS_TOLERANCE_MM}mm RMS of a true plane — what a straightedge would accept`,
    "Crowned studs and proud sheet edges shadow through paint and wear through flooring"),
  d(9, "Framing on regular centers", "structure", "geometry", FRAMING_OPEN,
    "Members at consistent 12/16/19.2/24in on-center spacing, low bay-to-bay variation",
    "Irregular centers strand sheathing and drywall edges off-stud — joints crack along them for decades"),
  d(10, "Headers sized and supported", "structure", "vision", ["framing"],
    "Headers over openings sized to span, bearing on the required jack studs",
    "An undersized header sags over years; doors and windows below it rack and bind"),
  d(11, "Top plates lapped and tied", "structure", "vision", ["framing"],
    "Double top plates lapped at corners and wall intersections",
    "Unlapped plates give up the diaphragm tie that holds walls together in wind and settlement"),
  d(12, "Notching and boring within limits", "structure", "vision",
    ["framing", "rough_plumbing", "rough_electrical", "hvac"],
    "No notches or bores beyond allowable fractions of member depth; no severed members left unrepaired",
    "An over-cut stud or joist is a hidden structural discount that surfaces as sag and squeak"),
  d(13, "Blocking and fire-stopping in place", "structure", "vision", ["framing", "insulation"],
    "Blocking where panels and fixtures need backing; fire-stopping closing concealed vertical chases",
    "Missing fire-stops let a wall cavity act as a chimney in a fire; missing blocking loosens everything mounted later"),
  d(14, "Sheathing fastening pattern", "structure", "vision", ["framing", "roofing"],
    "Consistent nailing on the required edge/field schedule, nails flush not overdriven",
    "Under-nailed sheathing is the first thing a windstorm finds; overdriven nails hold nothing"),
  d(15, "Reinforcement placed and tied", "structure", "vision", ["site", "foundation"],
    "Rebar at consistent spacing with proper laps, tied and chaired off the soil",
    "Steel out of position cannot stop the crack it was placed for — concrete fails in tension without it"),

  // ——— Moisture (the slow killer) ———
  d(16, "Water drains away from the work", "moisture", "vision", ["site", "foundation", "final"],
    "Positive grade away from the structure; no standing water in trenches or against walls",
    "Water against a foundation finds every cold joint; grading is the cheapest waterproofing there is"),
  d(17, "Below-grade faces damp-proofed", "moisture", "vision", ["foundation"],
    "Damp-proofing or waterproofing applied continuously to exterior below-grade concrete",
    "A skipped coat becomes a wet basement — the defect surfaces years later, behind finished walls"),
  d(18, "Weather barrier laps shed water", "moisture", "vision", ["roofing"],
    "WRB and underlayment lapped shingle-style, upper over lower, seams taped where required",
    "A reverse lap channels rain into the assembly instead of over it; rot starts at exactly that line"),
  d(19, "Openings pan-flashed", "moisture", "vision", ["roofing"],
    "Window and door rough openings sill-panned and taped before units go in",
    "Every window leaks eventually — a pan flashing decides whether that water exits or feeds the framing"),
  d(20, "Valleys and penetrations flashed", "moisture", "vision", ["roofing"],
    "Continuous flashing at valleys, step flashing at walls, boots sealed at penetrations",
    "Valley and penetration leaks travel along framing and surface far from the entry — the hardest leaks to trace"),
  d(21, "Vapour retarder continuous", "moisture", "vision", ["insulation"],
    "Vapour retarder un-torn, sealed at seams and penetrations where the climate requires one",
    "Moist interior air reaching a cold cavity condenses there — mold grows on the inside of the wall you can't see"),
  d(22, "Wet areas built for water", "moisture", "vision", ["drywall", "finishes"],
    "Moisture-resistant board and sealed joints at tubs, showers, and splash zones",
    "Regular board behind tile wicks and crumbles; the rebuild costs fifty times the board upgrade"),
  d(23, "Condensate handled with fall and trap", "moisture", "vision", ["hvac"],
    "Condensate line sloped continuously to a legal termination, trapped at the equipment",
    "A flat condensate run overflows into the ceiling below every humid season"),

  // ——— Envelope & thermal ———
  d(24, "Bearing on undisturbed soil", "envelope", "vision", ["site"],
    "Footing excavation reaches undisturbed or properly compacted soil, no loose fill in trenches",
    "Footings on fill settle differentially — the crack pattern shows up in year two and never stops"),
  d(25, "Anchor bolts set to schedule", "envelope", "vision", ["foundation"],
    "Anchor bolts at required spacing and embedment, within allowed distance of plate ends",
    "The sill connection is what holds the house to the ground in uplift; missing bolts are invisible after framing"),
  d(26, "Concrete consolidated, no cold joints", "envelope", "vision", ["foundation"],
    "No honeycombing, exposed aggregate voids, or unplanned cold joints in the finished pour",
    "Honeycomb is a water path and a strength discount cast permanently into the wall"),
  d(27, "Roof plane true", "envelope", "vision", ["roofing"],
    "Roof deck even between rafters, no visible deflection or waviness",
    "A wavy deck ponds water and wears shingles unevenly — the roof ages in patches"),
  d(28, "Insulation fills the cavity", "envelope", "vision", ["insulation"],
    "Batts at full loft filling depth and width, split around wiring, no voids or compression",
    "A 5% void can cost a quarter of a wall's R-value; compressed corners frost first and stain later"),
  d(29, "Rim joist and plate penetrations sealed", "envelope", "vision", ["insulation"],
    "Rim joist insulated and air-sealed; top-plate penetrations foamed or caulked",
    "The rim joist is the biggest air leak in most houses — energy loss and condensation for the building's whole life"),
  d(30, "Eaves protected", "envelope", "vision", ["roofing"],
    "Drip edge installed under/over underlayment correctly; ice-and-water shield where climate requires",
    "Edge water wicks into fascia and sheathing; ice dams find any eave without membrane"),

  // ——— Mechanical rough-in ———
  d(31, "Drains fall to the stack", "mechanical", "vision", ["rough_plumbing"],
    "Drain lines hold consistent slope (≈ 1/4in per foot) with no bellies or back-grades",
    "A flat or bellied drain clogs on a schedule for as long as the house stands"),
  d(32, "Every trap vented", "mechanical", "vision", ["rough_plumbing"],
    "Vents rise within allowable distance of each trap, no S-traps or flat vents",
    "An unvented trap siphons dry and lets sewer gas into the room — a smell nobody ever traces to framing decisions"),
  d(33, "Supply lines supported and shielded", "mechanical", "vision", ["rough_plumbing"],
    "Piping supported at required intervals, sleeved through concrete, nail plates where close to stud faces",
    "An unprotected line takes a drywall screw years later — the leak starts inside a finished wall"),
  d(34, "System holding test pressure", "mechanical", "vision", ["rough_plumbing"],
    "Pressure test gauge on the system and holding at time of capture",
    "The rough-in test is the only cheap moment to find a joint that weeps"),
  d(35, "Boxes set square and to depth", "mechanical", "vision", ["rough_electrical"],
    "Boxes mounted plumb at finished-wall depth with adequate fill capacity for their conductors",
    "Proud or sunken boxes mean gaps at every plate; overfilled boxes overheat splices"),
  d(36, "Cables secured on schedule", "mechanical", "vision", ["rough_electrical"],
    "Cables stapled within 8in of boxes and every 4.5ft, without crushing the sheath",
    "Unsupported cable chafes on framing edges; crushed sheath is a latent fault behind the wall"),
  d(37, "Nail plates over close cables", "mechanical", "vision", ["rough_electrical"],
    "Steel plates protecting any cable or pipe within 1.25in of a stud face",
    "The trim carpenter's nail finds the unprotected cable — a short or a slow leak sealed behind finish work"),
  d(38, "Panel organized and labelled", "mechanical", "vision", ["rough_electrical", "final"],
    "Home runs labelled at the panel, conductors dressed, breakers matched to wire gauge",
    "An unlabelled panel taxes every future repair; an oversized breaker on small wire is a fire waiting for a load"),
  d(39, "Duct joints fastened and sealed", "mechanical", "vision", ["hvac"],
    "Joints mechanically fastened and mastic-sealed, boots sealed to duct and framing",
    "Leaky ducts dump conditioned air into cavities — a permanent 20% tax on every utility bill"),
  d(40, "Flex duct run without strangling", "mechanical", "vision", ["hvac"],
    "Flex duct supported per schedule, pulled taut, no compression or sharp bends",
    "A crushed flex run starves its register forever; the room it serves never conditions right"),

  // ——— Surfaces & finish ———
  d(41, "Drywall hung to pattern", "surfaces", "vision", ["drywall"],
    "Sheets hung with staggered joints and correct fastener spacing",
    "Aligned joints crack in a straight line at the first seasonal movement"),
  d(42, "Fasteners and joints finished flat", "surfaces", "vision", ["drywall"],
    "No fastener heads proud of the surface; seams flat with no ridging or starved joints",
    "Every proud head and starved joint shadows through the final coat under raking light"),
  d(43, "Corner bead true", "surfaces", "vision", ["drywall"],
    "Corner bead straight, fully embedded, no rattle or exposed edges",
    "Loose bead cracks its corner open within a year of door slams"),
  d(44, "Trim fitted tight", "surfaces", "vision", ["finishes"],
    "Mitres closed, reveals even, joints filled and sanded before finish",
    "Open mitres only widen as material moves seasonally — they never close on their own"),
  d(45, "Flooring flat and true", "surfaces", "vision", ["finishes"],
    "Transitions flush, no lippage between pieces, expansion gaps kept at edges",
    "Lippage becomes a trip edge and a wear line; a missing expansion gap buckles the field"),
  d(46, "Finish coats even", "surfaces", "vision", ["finishes"],
    "Even coverage, straight cut lines, no visible laps, drips, or missed spots",
    "Thin coverage weathers out first; the surface reads cheap long before it fails"),

  // ——— Safety & occupancy ———
  d(47, "Excavation safe to work", "safety", "vision", ["site"],
    "Trench walls benched, sloped, or shored where depth requires; spoil set back from edges",
    "A trench collapse is the fastest fatality on a residential site — the record should show it was managed"),
  d(48, "Alarms placed for occupancy", "safety", "vision", ["finishes", "final"],
    "Smoke and CO alarms in each sleeping area, hallways, and each level per code placement",
    "Alarm placement is the cheapest life-safety item in the whole build and the most often missed"),
  d(49, "Fixtures installed and operable", "safety", "vision", ["final"],
    "All fixtures and appliances installed, connected, and operable at walkthrough",
    "The handover record proves what worked on day one — the baseline every warranty claim is judged against"),
  d(50, "Mechanicals accessible and labelled", "safety", "vision", ["hvac", "final"],
    "Equipment reachable with service clearance, shutoffs accessible, nameplates legible and recorded",
    "Buried equipment turns every future service call into demolition"),
];

/* The ledger must stay exactly fifty and exactly sequential — it is quoted
 * to homeowners as "the 50-point assessment". */
if (CHECKPOINTS.length !== 50) throw new Error(`Checkpoint ledger has ${CHECKPOINTS.length} entries, expected 50`);
CHECKPOINTS.forEach((c, i) => {
  if (c.num !== i + 1) throw new Error(`Checkpoint ${c.id} out of sequence`);
});

export function checkpointsForStage(stage: StageId): CheckpointDef[] {
  return CHECKPOINTS.filter((c) => c.stages.includes(stage));
}

/** The subset the vision grader is asked to judge at this stage. */
export function visionCheckpointsForStage(stage: StageId): CheckpointDef[] {
  return checkpointsForStage(stage).filter((c) => c.source === "vision");
}

/** A verdict the vision grader returned for one checkpoint id. */
export type VisionVerdict = {
  id: string;
  status: CheckpointStatus;
  evidence: string;
  frameIndex?: number;
};

function result(
  def: CheckpointDef,
  status: CheckpointStatus,
  evidence: string,
  keyframeIndex?: number,
): CheckpointResult {
  return {
    id: def.id,
    num: def.num,
    title: def.title,
    standard: def.standard,
    longevity: def.longevity,
    category: def.category,
    status,
    evidence,
    source: def.source === "capture" ? "capture" : def.source,
    keyframeIndex,
  };
}

/**
 * Deterministic verdicts for the capture/geometry checkpoints, computed off
 * the reconstruction. Thresholds mirror quality.ts so the ledger and the
 * findings never disagree.
 */
function evaluateMeasured(def: CheckpointDef, recon: ReconResult): CheckpointResult {
  const m = recon.metrics;
  const g = recon.geometry;

  const graded = (
    value: number,
    passAt: number,
    failAt: number,
    evidence: string,
    lowerIsBetter = false,
  ): CheckpointResult => {
    const pass = lowerIsBetter ? value <= passAt : value >= passAt;
    const fail = lowerIsBetter ? value >= failAt : value <= failAt;
    return result(def, pass ? "pass" : fail ? "fail" : "attention", evidence);
  };

  switch (def.id) {
    case "QC-01": {
      const r = m.framesSubmitted > 0 ? m.framesRegistered / m.framesSubmitted : 0;
      return graded(r, 0.75, 0.5, `${m.framesRegistered}/${m.framesSubmitted} frames registered (${Math.round(r * 100)}%)`);
    }
    case "QC-02":
      return graded(m.sharpness, SHARPNESS_FLOOR, SHARPNESS_FLOOR * 0.5, `median sharpness ${m.sharpness.toFixed(0)} against a floor of ${SHARPNESS_FLOOR}`);
    case "QC-03":
      return graded(m.meshCompleteness, 0.6, 0.4, `${Math.round(m.meshCompleteness * 100)}% of the surface closed`);
    case "QC-04":
      return m.scaleSource === "assumed"
        ? result(def, "attention", "scale assumed — place a tape or 4ft level in the next capture to lock it")
        : result(def, "pass", `scale fixed by ${m.scaleSource === "reference_object" ? "a reference object" : "detected stud spacing"} at ${m.metresPerUnit.toFixed(3)} m/unit`);
    case "QC-05":
      return graded(m.reprojectionErrorPx, 1.2, REPROJ_ERROR_CEILING_PX, `${m.reprojectionErrorPx.toFixed(2)}px mean reprojection error`, true);
    case "QC-06": {
      const walls = g.planes.filter((p) => p.kind === "wall");
      if (walls.length === 0) return result(def, "not_assessable", "no wall planes detected in this capture");
      const area = walls.reduce((a, p) => a + p.areaM2, 0);
      const dev = walls.reduce((a, p) => a + p.deviationDeg * p.areaM2, 0) / area;
      return graded(dev, PLUMB_TOLERANCE_DEG, PLUMB_TOLERANCE_DEG * 2, `area-weighted lean ${dev.toFixed(2)}° across ${walls.length} wall planes`, true);
    }
    case "QC-07": {
      const flats = g.planes.filter((p) => p.kind === "floor" || p.kind === "ceiling");
      if (flats.length === 0) return result(def, "not_assessable", "no floor or ceiling planes detected in this capture");
      const area = flats.reduce((a, p) => a + p.areaM2, 0);
      const dev = flats.reduce((a, p) => a + p.deviationDeg * p.areaM2, 0) / area;
      return graded(dev, PLUMB_TOLERANCE_DEG, PLUMB_TOLERANCE_DEG * 2, `area-weighted deviation ${dev.toFixed(2)}° across ${flats.length} planes`, true);
    }
    case "QC-08": {
      const walls = g.planes.filter((p) => p.kind === "wall" && p.areaM2 > 2);
      if (walls.length === 0) return result(def, "not_assessable", "no wall planes large enough to judge flatness");
      const worst = Math.max(...walls.map((p) => p.flatnessMm));
      return graded(worst, FLATNESS_TOLERANCE_MM, FLATNESS_TOLERANCE_MM * 2, `worst plane ${worst.toFixed(1)}mm RMS off true`, true);
    }
    case "QC-09": {
      if (g.studSpacingIn == null)
        return result(def, "not_assessable", "no repeating framing members detected in the mesh");
      const cv = g.studSpacingCv ?? 0;
      const nearest = [12, 16, 19.2, 24].reduce((a, b) =>
        Math.abs(b - g.studSpacingIn!) < Math.abs(a - g.studSpacingIn!) ? b : a,
      );
      const off = Math.abs(g.studSpacingIn - nearest);
      const status: CheckpointStatus =
        cv <= 0.05 && off <= 0.5 ? "pass" : cv > 0.08 || off > 1.5 ? "fail" : "attention";
      return result(def, status, `${g.studSpacingIn.toFixed(1)}in OC, ${(cv * 100).toFixed(0)}% bay-to-bay variation, nearest nominal ${nearest}in`);
    }
    default:
      return result(def, "not_assessable", "no measured evaluator for this checkpoint");
  }
}

export type CheckpointEvaluation = {
  results: CheckpointResult[];
  passed: number;
  assessed: number;
  applicable: number;
};

/**
 * Full ledger for one stage. `visionVerdicts` come from the vision grader and
 * may be empty (vision unavailable, or the footage showed the wrong stage) —
 * every vision checkpoint then reads not_assessable with the reason given.
 */
export function evaluateCheckpoints(
  recon: ReconResult,
  stage: StageId,
  visionVerdicts: VisionVerdict[],
  visionUnavailableReason?: string,
): CheckpointEvaluation {
  const defs = checkpointsForStage(stage);
  const byId = new Map(visionVerdicts.map((v) => [v.id, v]));
  const validStatus = new Set<CheckpointStatus>(["pass", "attention", "fail", "not_assessable"]);

  const results = defs.map((def) => {
    if (def.source !== "vision") return evaluateMeasured(def, recon);
    const v = byId.get(def.id);
    if (!v || !validStatus.has(v.status)) {
      return result(
        def,
        "not_assessable",
        visionUnavailableReason ?? "not visible in the reviewed frames",
      );
    }
    return result(def, v.status, v.evidence, v.frameIndex);
  });

  const assessedList = results.filter((r) => r.status !== "not_assessable");
  return {
    results,
    passed: assessedList.filter((r) => r.status === "pass").length,
    assessed: assessedList.length,
    applicable: defs.length,
  };
}

/** For the vision prompt: the checklist block for this stage's judged points. */
export function visionCheckpointPrompt(stage: StageId): string {
  const defs = visionCheckpointsForStage(stage);
  if (defs.length === 0) return "";
  return [
    `This stage carries ${defs.length} points of the HomeFAX 50-point assessment that only eyes can judge. For EACH id below return a verdict:`,
    `- "pass" — the frames show it done to the standard`,
    `- "attention" — visible but marginal; name what is marginal`,
    `- "fail" — the frames show it not meeting the standard`,
    `- "not_assessable" — the relevant work or area is not visible in these frames`,
    `Every verdict carries one line of evidence naming what you saw and the frame it is in. Never pass a point you cannot actually see.`,
    "",
    ...defs.map((c) => `${c.id} · ${c.title} — standard: ${c.standard}`),
    "",
    `Stage context: ${stageDef(stage).label}.`,
  ].join("\n");
}
