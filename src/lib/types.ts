/**
 * Shared vocabulary for the whole app. The recon service (Python) mirrors these
 * shapes on the wire, so keep field names in sync with services/recon/app/schema.py.
 */

export type StageId =
  | "site"
  | "foundation"
  | "framing"
  | "roofing"
  | "rough_plumbing"
  | "rough_electrical"
  | "hvac"
  | "insulation"
  | "drywall"
  | "finishes"
  | "final";

export type JobState =
  | "queued"
  | "extracting"
  | "registering"
  | "reconstructing"
  | "meshing"
  | "analyzing"
  | "done"
  | "failed";

/** One step of the reconstruction, as reported by the recon service. */
export type JobStep = {
  key: string;
  label: string;
  state: "pending" | "running" | "done" | "failed";
  detail?: string;
  seconds?: number;
};

/** Objective numbers the reconstruction produces about its own output. */
export type ReconMetrics = {
  /** Frames the SfM solver successfully registered / frames submitted. */
  framesRegistered: number;
  framesSubmitted: number;
  /** Mean reprojection error in pixels — lower is a tighter solve. */
  reprojectionErrorPx: number;
  /** Dense points after fusion. */
  pointCount: number;
  /** Triangles in the delivered mesh (post-decimation). */
  triangleCount: number;
  /** Fraction of the reconstructed volume's surface that is watertight. */
  meshCompleteness: number;
  /** Median sharpness (variance of Laplacian) of the selected keyframes. */
  sharpness: number;
  /** Metres per world unit — the scale estimate the takeoff math depends on. */
  metresPerUnit: number;
  /** How the scale was fixed: real reference or assumed. */
  scaleSource: "reference_object" | "stud_spacing" | "assumed";
  /** Delivered GLB size in bytes, after Draco compression. */
  glbBytes: number;
};

/** A measured plane in the scene — walls, floors, ceilings. Drives geometry checks. */
export type ScenePlane = {
  kind: "wall" | "floor" | "ceiling" | "other";
  areaM2: number;
  /** Degrees off true vertical (walls) or true horizontal (floors/ceilings). */
  deviationDeg: number;
  /** RMS distance of inlier points to the fitted plane, in mm — flatness. */
  flatnessMm: number;
};

/** Geometry the recon service measures directly off the mesh. */
export type SceneGeometry = {
  boundingBoxM: [number, number, number];
  floorAreaM2: number;
  wallAreaM2: number;
  ceilingHeightM: number | null;
  planes: ScenePlane[];
  /** Detected repeating vertical members and their spacing, in inches. */
  studSpacingIn: number | null;
  studSpacingCv: number | null;
};

export type ReconResult = {
  glbUrl: string;
  pointCloudUrl?: string;
  keyframeUrls: string[];
  metrics: ReconMetrics;
  geometry: SceneGeometry;
};

export type ReconJob = {
  id: string;
  state: JobState;
  steps: JobStep[];
  error?: string;
  result?: ReconResult;
};

export type Severity = "info" | "minor" | "major" | "critical";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Which rubric dimension this counted against. */
  dimension: QualityDimension;
  /** Where it came from, so the UI can show the receipts. */
  source: "geometry" | "vision" | "capture";
  keyframeIndex?: number;
};

export type QualityDimension =
  | "capture"
  | "geometry"
  | "workmanship"
  | "compliance";

export type DimensionScore = {
  dimension: QualityDimension;
  score: number; // 0-100
  weight: number; // 0-1, sums to 1 across dimensions for the stage
  basis: string; // one line explaining what produced the number
};

/**
 * The 50-point ledger. Every HomeFAX record is assessed against the same 50
 * named checkpoints; each stage evaluates the subset that is visible at that
 * stage. A checkpoint verdict always says where it came from.
 */
export type CheckpointStatus = "pass" | "attention" | "fail" | "not_assessable";

export type CheckpointResult = {
  /** Stable id, "QC-01" through "QC-50". */
  id: string;
  /** 1-50, for display ordering. */
  num: number;
  title: string;
  /** The best practice or code expectation being checked, one line. */
  standard: string;
  /** What failing this costs the building over its life, one line. */
  longevity: string;
  category: CheckpointCategory;
  status: CheckpointStatus;
  /** One line of evidence: the measurement or the frame observation behind the verdict. */
  evidence: string;
  source: "geometry" | "capture" | "vision";
  keyframeIndex?: number;
};

export type CheckpointCategory =
  | "structure"
  | "envelope"
  | "mechanical"
  | "surfaces"
  | "moisture"
  | "safety"
  | "capture";

export type QualityReport = {
  score: number; // 0-100 weighted
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: DimensionScore[];
  findings: Finding[];
  /** Verdicts for every checkpoint applicable at this stage. */
  checkpoints?: CheckpointResult[];
  /** Passed / assessed counts over the applicable set, for the headline. */
  checkpointsPassed?: number;
  checkpointsAssessed?: number;
  checkpointsApplicable?: number;
  /** True only when the visual review produced a usable assessment. */
  visionAvailable: boolean;
  /** Why the judged dimensions were or were not scored. */
  visionStatus?: "graded" | "unavailable" | "stage_not_shown";
  /** Shown to the contractor when the review could not be used. */
  visionNote?: string;
};

export type PartCategory =
  | "lumber"
  | "concrete"
  | "fastener"
  | "electrical"
  | "plumbing"
  | "hvac"
  | "insulation"
  | "drywall"
  | "roofing"
  | "finish"
  | "fixture"
  | "hardware";

export type PartLine = {
  id: string;
  sku: string;
  name: string;
  category: PartCategory;
  spec?: string;
  quantity: number;
  unit: "ea" | "lf" | "sf" | "cy" | "sheet" | "box" | "roll" | "gal" | "pail" | "tube" | "pair" | "set";
  /** How the quantity was arrived at — the number is only as good as this. */
  basis: "measured" | "detected" | "derived";
  /** Plain-language derivation, e.g. "112 lf wall / 16in OC + 3 corners". */
  derivation: string;
  confidence: number; // 0-1
  unitCostUsd?: number;
  stage: StageId;
  /**
   * Exact identification, when the review could read it off a label, nameplate,
   * or finish: manufacturer, model/product line, color, size. Only populated
   * from something actually legible in a frame — never inferred.
   */
  identified?: {
    manufacturer?: string;
    model?: string;
    color?: string;
    finish?: string;
    size?: string;
    readFrom?: string; // e.g. "nameplate in frame 4"
  };
};

export type StageRecord = {
  stage: StageId;
  capturedAt?: string;
  job?: ReconJob;
  quality?: QualityReport;
  parts: PartLine[];
  notes?: string;
};

export type HomeRecord = {
  id: string;
  slug: string;
  address: string;
  owner?: string;
  contractor?: string;
  createdAt: string;
  stages: StageRecord[];
};
