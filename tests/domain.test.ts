/**
 * Domain tests — the grading and takeoff maths, with no network or DB.
 *
 *   npm test
 *
 * These cover the failure modes that would be invisible in the UI: a stage that
 * scores well because nothing was assessed, a quantity that double-counts across
 * stages, a takeoff that silently ignores measured spacing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { cumulativeParts, partsSubtotal, takeoffFromGeometry } from "../src/lib/parts";
import { buildQualityReport, scoreCapture, toGrade } from "../src/lib/quality";
import type { Finding, PartLine, ReconResult } from "../src/lib/types";

function recon(over: Partial<ReconResult["metrics"]> = {}): ReconResult {
  return {
    glbUrl: "https://example.test/scene.glb",
    keyframeUrls: [],
    metrics: {
      framesRegistered: 58,
      framesSubmitted: 60,
      reprojectionErrorPx: 0.8,
      pointCount: 1_500_000,
      triangleCount: 180_000,
      meshCompleteness: 0.88,
      sharpness: 190,
      metresPerUnit: 1,
      scaleSource: "assumed",
      glbBytes: 3_000_000,
      ...over,
    },
    geometry: {
      boundingBoxM: [8, 2.44, 6],
      floorAreaM2: 46.4, // 500 sf
      wallAreaM2: 92.9, // 1000 sf
      ceilingHeightM: 2.44,
      planes: [
        { kind: "floor", areaM2: 46, deviationDeg: 0.2, flatnessMm: 3 },
        { kind: "wall", areaM2: 22, deviationDeg: 0.3, flatnessMm: 3 },
        { kind: "wall", areaM2: 20, deviationDeg: 0.4, flatnessMm: 4 },
        { kind: "ceiling", areaM2: 46, deviationDeg: 0.3, flatnessMm: 4 },
      ],
      studSpacingIn: 16.1,
      studSpacingCv: 0.03,
    },
  };
}

test("capture score falls when frames fail to register", () => {
  const good = scoreCapture(recon());
  const bad = scoreCapture(recon({ framesRegistered: 22 }));

  assert.ok(good.score > 80, `clean capture scored ${good.score}`);
  assert.ok(bad.score < good.score - 20, "a half-failed solve must cost real points");
  assert.ok(bad.findings.some((f) => f.id === "capture-registration"));
});

test("an unassessed stage is not scored as a perfect one", () => {
  // The regression this guards: workmanship starts at 100 and deducts per
  // finding, so a review that assessed nothing would otherwise score full marks.
  const graded = buildQualityReport(recon(), "framing", [], { status: "graded" });
  const notShown = buildQualityReport(recon(), "framing", [], {
    status: "stage_not_shown",
    note: "The footage does not show this stage.",
  });

  assert.equal(graded.dimensions.length, 4);
  assert.equal(notShown.dimensions.length, 2, "judged dimensions must be dropped");
  assert.ok(
    !notShown.dimensions.some(
      (d) => d.dimension === "workmanship" || d.dimension === "compliance",
    ),
  );

  const weight = notShown.dimensions.reduce((a, d) => a + d.weight, 0);
  assert.ok(Math.abs(weight - 1) < 1e-9, "remaining weights must renormalise to 1");
  assert.equal(notShown.visionAvailable, false);
  assert.match(notShown.visionNote ?? "", /does not show/);
});

test("findings cost the dimension they landed on", () => {
  const findings: Finding[] = [
    {
      id: "v1",
      severity: "critical",
      title: "Missing jack studs",
      detail: "…",
      dimension: "compliance",
      source: "vision",
    },
  ];
  const report = buildQualityReport(recon(), "framing", findings, { status: "graded" });
  const compliance = report.dimensions.find((d) => d.dimension === "compliance")!;
  const workmanship = report.dimensions.find((d) => d.dimension === "workmanship")!;

  assert.equal(compliance.score, 66, "critical costs 34 points");
  assert.equal(workmanship.score, 100, "an unrelated dimension is untouched");
  assert.equal(report.findings[0].severity, "critical", "findings sort worst-first");
});

test("grade boundaries", () => {
  assert.equal(toGrade(90), "A");
  assert.equal(toGrade(89.9), "B");
  assert.equal(toGrade(59), "F");
});

test("framing takeoff follows the measured spacing", () => {
  const at16 = takeoffFromGeometry(recon(), "framing");
  const wide = takeoffFromGeometry(
    { ...recon(), geometry: { ...recon().geometry, studSpacingIn: 24 } },
    "framing",
  );

  const studs16 = at16.find((p) => p.sku === "LUM-2X4-92")!;
  const studs24 = wide.find((p) => p.sku === "LUM-2X4-92")!;

  // 1000 sf of wall at 8 ft high is 125 lf; at 16in OC that is ~94 studs + 3.
  assert.ok(studs16.quantity > 90 && studs16.quantity < 100, `got ${studs16.quantity}`);
  assert.ok(studs24.quantity < studs16.quantity, "wider spacing needs fewer studs");
  assert.equal(studs16.basis, "measured");
  assert.match(studs16.derivation, /16\.1in OC/);

  const plate = at16.find((p) => p.sku === "LUM-2X4-PLATE")!;
  assert.ok(Math.abs(plate.quantity - 125 * 3) < 5, `plate stock was ${plate.quantity}`);
});

test("assumed scale is disclosed and discounts confidence", () => {
  const assumed = takeoffFromGeometry(recon(), "drywall")[0];
  const referenced = takeoffFromGeometry(
    { ...recon(), metrics: { ...recon().metrics, scaleSource: "reference_object" } },
    "drywall",
  )[0];

  assert.match(assumed.derivation, /scale assumed/);
  assert.ok(referenced.confidence > assumed.confidence);
});

test("cumulative parts supersede rather than double-order", () => {
  const early: PartLine[] = [
    {
      id: "framing:LUM-2X4-92",
      sku: "LUM-2X4-92",
      name: "2x4 stud",
      category: "lumber",
      quantity: 40,
      unit: "ea",
      basis: "detected",
      derivation: "counted in frame 3",
      confidence: 0.6,
      stage: "framing",
    },
  ];
  const later: PartLine[] = [
    { ...early[0], id: "insulation:LUM-2X4-92", quantity: 97, basis: "measured", stage: "insulation" },
  ];

  const rolled = cumulativeParts([
    { stage: "framing", parts: early },
    { stage: "insulation", parts: later },
  ]);

  assert.equal(rolled.length, 1, "the same SKU must not appear twice");
  assert.equal(rolled[0].quantity, 97, "the measured count wins");
  assert.match(rolled[0].derivation, /supersedes framing estimate/);
});

test("same SKU twice within one stage adds up", () => {
  const line: PartLine = {
    id: "framing:ELE-BOX-1G",
    sku: "ELE-BOX-1G",
    name: "Single-gang box",
    category: "electrical",
    quantity: 6,
    unit: "ea",
    basis: "detected",
    derivation: "counted",
    confidence: 0.7,
    stage: "framing",
  };

  const rolled = cumulativeParts([{ stage: "framing", parts: [line, { ...line, quantity: 4 }] }]);
  assert.equal(rolled[0].quantity, 10);
});

test("subtotal only counts priced lines", () => {
  const priced = takeoffFromGeometry(recon(), "drywall");
  assert.ok(partsSubtotal(priced) > 0);
  assert.equal(partsSubtotal([]), 0);
});
