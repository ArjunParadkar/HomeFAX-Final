import type { PartCategory, QualityDimension, StageId } from "./types";

/**
 * The construction sequence a HomeFAX record walks through. Order matters: the
 * cumulative parts list and the "what's buried behind this wall" story both
 * depend on stages being append-only in this order.
 */
export type StageDef = {
  id: StageId;
  label: string;
  /** Two or three words — this is what fits on a phone in the timeline. */
  short: string;
  blurb: string;
  /** Filmed guidance shown right before the camera opens. */
  captureGuide: string[];
  /** What a good job looks like at this stage — fed to the vision grader verbatim. */
  checklist: string[];
  /** Rubric weights for this stage; must sum to 1. */
  weights: Record<QualityDimension, number>;
  /** Part families we expect to take off at this stage. */
  expects: PartCategory[];
  /** Stages where framing members are exposed, so stud-spacing checks apply. */
  exposedFraming: boolean;
};

export const STAGES: StageDef[] = [
  {
    id: "site",
    label: "Site Prep & Excavation",
    short: "Site",
    blurb: "Grade, dig, and drainage before anything is poured.",
    captureGuide: [
      "Walk the full perimeter of the excavation, keeping the far edge in frame",
      "Hold on each corner for two seconds so the solver locks the geometry",
      "Include a tape measure or a 4ft level on the ground for scale",
    ],
    checklist: [
      "Excavation reaches undisturbed soil, no loose fill in the footing trench",
      "Trench walls are stable and benched or sloped where required",
      "Positive drainage away from the dig; no standing water",
      "Utility trenches are separated and to depth",
    ],
    weights: { capture: 0.35, geometry: 0.25, workmanship: 0.25, compliance: 0.15 },
    expects: ["concrete", "hardware"],
    exposedFraming: false,
  },
  {
    id: "foundation",
    label: "Foundation & Slab",
    short: "Foundation",
    blurb: "Footings, walls, rebar, and the slab pour.",
    captureGuide: [
      "Film every wall face from about 6ft back, then a second slow pass close in",
      "Capture rebar spacing and overlaps before the pour",
      "Get all four corners and any step-downs",
    ],
    checklist: [
      "Rebar spacing and lap lengths are consistent and tied",
      "Forms are plumb and braced; no visible bowing",
      "Anchor bolts are set at the correct spacing and embedment",
      "No honeycombing or cold joints in the finished pour",
      "Damp-proofing applied to exterior below-grade faces",
    ],
    weights: { capture: 0.25, geometry: 0.3, workmanship: 0.25, compliance: 0.2 },
    expects: ["concrete", "hardware", "fastener"],
    exposedFraming: false,
  },
  {
    id: "framing",
    label: "Framing",
    short: "Framing",
    blurb: "The skeleton — studs, plates, headers, joists, and sheathing.",
    captureGuide: [
      "One continuous lap of each room with the camera at chest height",
      "Then a second lap angled up to catch the ceiling joists",
      "Slow down at headers, corners, and anywhere the framing changes",
    ],
    checklist: [
      "Studs are at consistent on-center spacing with no missing members",
      "Headers are sized and supported by the correct number of jack studs",
      "Double top plates are lapped at corners and intersections",
      "Blocking and fire-stopping present where required",
      "No notching or boring beyond allowable limits",
      "Sheathing nailing pattern is consistent, no overdriven nails",
    ],
    weights: { capture: 0.2, geometry: 0.3, workmanship: 0.25, compliance: 0.25 },
    expects: ["lumber", "fastener", "hardware"],
    exposedFraming: true,
  },
  {
    id: "roofing",
    label: "Roof & Envelope",
    short: "Roof",
    blurb: "Sheathing, underlayment, flashing, windows, and weather barrier.",
    captureGuide: [
      "Film the roof planes from ground level on all sides, then any accessible eave close-ups",
      "Capture every window and door opening with its flashing",
      "Include valleys, penetrations, and the drip edge",
    ],
    checklist: [
      "Weather-resistive barrier laps shingle-style, upper over lower",
      "Window and door openings are pan-flashed and taped",
      "Valley and penetration flashing is continuous",
      "Roof plane is even, no visible deck deflection between rafters",
    ],
    weights: { capture: 0.3, geometry: 0.25, workmanship: 0.25, compliance: 0.2 },
    expects: ["roofing", "lumber", "fastener"],
    exposedFraming: true,
  },
  {
    id: "rough_plumbing",
    label: "Rough Plumbing",
    short: "Plumbing",
    blurb: "Supply, waste, and vent lines in the open walls.",
    captureGuide: [
      "Follow each run end to end rather than panning across the room",
      "Get every fixture stub-out and every cleanout",
      "Capture the pressure test gauge if one is on the system",
    ],
    checklist: [
      "Drain lines maintain consistent fall toward the stack",
      "Vents rise within allowable distance of each trap",
      "Supply lines are supported at required intervals and protected by nail plates",
      "No unsupported spans crossing framing bays",
      "Test gauge holding pressure at time of capture",
    ],
    weights: { capture: 0.25, geometry: 0.2, workmanship: 0.3, compliance: 0.25 },
    expects: ["plumbing", "hardware", "fastener"],
    exposedFraming: true,
  },
  {
    id: "rough_electrical",
    label: "Rough Electrical",
    short: "Electrical",
    blurb: "Boxes, home runs, and the panel before it disappears.",
    captureGuide: [
      "Walk each wall and hold on every box for two seconds",
      "Follow the home runs back to the panel",
      "Open the panel and film the whole face, then close in on the labels",
    ],
    checklist: [
      "Boxes are set to the finished drywall depth and mounted square",
      "Cables are stapled within 8in of boxes and every 4.5ft after",
      "Nail plates protect any cable within 1.25in of the stud face",
      "Home runs are labelled at the panel",
      "Box fill looks within limits for the conductor count present",
    ],
    weights: { capture: 0.25, geometry: 0.15, workmanship: 0.3, compliance: 0.3 },
    expects: ["electrical", "fastener", "hardware"],
    exposedFraming: true,
  },
  {
    id: "hvac",
    label: "HVAC Rough-In",
    short: "HVAC",
    blurb: "Ducts, line sets, and equipment placement.",
    captureGuide: [
      "Follow the trunk line from the air handler out to each branch",
      "Capture every register boot and its seal",
      "Film the equipment nameplate legibly",
    ],
    checklist: [
      "Duct joints are mechanically fastened and mastic-sealed",
      "Flex duct is supported without compression or sharp bends",
      "Boots are sealed to the framing and to the duct",
      "Condensate line is run with fall and a trap",
    ],
    weights: { capture: 0.25, geometry: 0.2, workmanship: 0.3, compliance: 0.25 },
    expects: ["hvac", "hardware", "fastener"],
    exposedFraming: true,
  },
  {
    id: "insulation",
    label: "Insulation & Air Sealing",
    short: "Insulation",
    blurb: "The last look into the wall cavity.",
    captureGuide: [
      "Film every wall in one pass — the grader is looking for gaps and voids",
      "Get the top plate penetrations and the rim joist",
      "Include any batt that has been cut around wiring",
    ],
    checklist: [
      "Batts fill the full cavity depth with no compression or voids",
      "Insulation is split around wiring and plumbing, not compressed behind it",
      "Rim joist and top plate penetrations are sealed",
      "Vapour retarder is continuous and un-torn where required",
    ],
    weights: { capture: 0.3, geometry: 0.15, workmanship: 0.35, compliance: 0.2 },
    expects: ["insulation", "fastener"],
    exposedFraming: true,
  },
  {
    id: "drywall",
    label: "Drywall",
    short: "Drywall",
    blurb: "Hang, tape, and finish — the walls close for good.",
    captureGuide: [
      "One lap per room after hanging, one after finishing",
      "Rake light along each wall if you can, it shows the seams",
      "Capture ceilings on a second pass",
    ],
    checklist: [
      "Sheets are hung with staggered joints and correct fastener spacing",
      "No fastener heads proud of the surface",
      "Seams are flat with no visible ridging or starved joints",
      "Corner bead is straight and fully embedded",
    ],
    weights: { capture: 0.25, geometry: 0.3, workmanship: 0.35, compliance: 0.1 },
    expects: ["drywall", "fastener"],
    exposedFraming: false,
  },
  {
    id: "finishes",
    label: "Interior Finishes",
    short: "Finishes",
    blurb: "Paint, trim, flooring, cabinets, and fixtures.",
    captureGuide: [
      "Room-by-room lap at chest height, then a slow pass along the floor",
      "Hold on each fixture and appliance nameplate",
      "Capture trim mitres and door reveals close up",
    ],
    checklist: [
      "Trim mitres are tight and consistent",
      "Door and drawer reveals are even",
      "Flooring transitions are flat with no lippage",
      "Paint coverage is even with cut lines straight",
    ],
    weights: { capture: 0.25, geometry: 0.25, workmanship: 0.4, compliance: 0.1 },
    expects: ["finish", "fixture", "hardware"],
    exposedFraming: false,
  },
  {
    id: "final",
    label: "Final Walkthrough",
    short: "Final",
    blurb: "The as-built record the homeowner inherits.",
    captureGuide: [
      "Walk the whole house in one continuous take, room to room",
      "Include the exterior perimeter",
      "Finish at the panel and the mechanical room",
    ],
    checklist: [
      "Every room is represented in the capture",
      "All fixtures are installed and operable",
      "No open punch-list damage visible",
      "Mechanical equipment is accessible and labelled",
    ],
    weights: { capture: 0.4, geometry: 0.2, workmanship: 0.3, compliance: 0.1 },
    expects: ["fixture", "finish", "hardware"],
    exposedFraming: false,
  },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

const BY_ID = new Map(STAGES.map((s) => [s.id, s]));

export function stageDef(id: StageId): StageDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown stage: ${id}`);
  return def;
}

export function stageIndex(id: StageId): number {
  return STAGE_IDS.indexOf(id);
}

export function isStageId(v: string): v is StageId {
  return BY_ID.has(v as StageId);
}
