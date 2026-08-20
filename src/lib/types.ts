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

export type QualityReport = {
  score: number; // 0-100 weighted
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: DimensionScore[];
  findings: Finding[];
  /** Set when the report is geometry-only because vision analysis was unavailable. */
  visionAvailable: boolean;
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
  unit: "ea" | "lf" | "sf" | "cy" | "sheet" | "box" | "roll";
  /** How the quantity was arrived at — the number is only as good as this. */
  basis: "measured" | "detected" | "derived";
  /** Plain-language derivation, e.g. "112 lf wall / 16in OC + 3 corners". */
  derivation: string;
  confidence: number; // 0-1
  unitCostUsd?: number;
  stage: StageId;
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
