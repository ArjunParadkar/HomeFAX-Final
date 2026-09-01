/**
 * Parts layer tests — catalog integrity, takeoff math, exact identification,
 * and cumulative supersede behavior.
 *
 *   npm test
 *
 * Follows the same structure as domain.test.ts (node:test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG, CATALOG_SKUS, expectedSkusForStage } from "../src/lib/catalog";
import { ExactDetection, buildPartsIdPrompt, detectionToPartLine } from "../src/lib/parts-id";
import { cumulativeParts, partFromDetection, takeoffFromGeometry } from "../src/lib/parts";
import type { PartLine, ReconResult, StageId } from "../src/lib/types";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const VALID_UNITS = new Set([
  "ea", "lf", "sf", "cy", "sheet", "box", "roll", "gal", "pail", "tube", "pair", "set",
]);

const VALID_CATEGORIES = new Set([
  "lumber", "concrete", "fastener", "electrical", "plumbing",
  "hvac", "insulation", "drywall", "roofing", "finish", "fixture", "hardware",
]);

function recon(over: Partial<ReconResult["metrics"]> = {}, geo: Partial<ReconResult["geometry"]> = {}): ReconResult {
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
      floorAreaM2: 46.4,   // ≈ 500 sf
      wallAreaM2: 92.9,    // ≈ 1000 sf
      ceilingHeightM: 2.44, // ≈ 8 ft
      planes: [],
      studSpacingIn: 16,
      studSpacingCv: 0.02,
      ...geo,
    },
  };
}

// ─── Catalog integrity ────────────────────────────────────────────────────────

test("all SKU ids are unique and match their record key", () => {
  for (const [key, entry] of Object.entries(CATALOG)) {
    assert.equal(entry.sku, key, `CATALOG["${key}"].sku mismatch`);
  }
});

test("CATALOG_SKUS matches Object.keys(CATALOG)", () => {
  const fromKeys = Object.keys(CATALOG).sort();
  const fromSkus = [...CATALOG_SKUS].sort();
  assert.deepEqual(fromSkus, fromKeys);
});

test("every entry has a valid unit", () => {
  for (const entry of Object.values(CATALOG)) {
    assert.ok(
      VALID_UNITS.has(entry.unit),
      `${entry.sku} has invalid unit "${entry.unit}"`,
    );
  }
});

test("every entry has a valid category", () => {
  for (const entry of Object.values(CATALOG)) {
    assert.ok(
      VALID_CATEGORIES.has(entry.category),
      `${entry.sku} has invalid category "${entry.category}"`,
    );
  }
});

test("unit costs are positive numbers when present", () => {
  for (const entry of Object.values(CATALOG)) {
    if (entry.unitCostUsd !== undefined) {
      assert.ok(entry.unitCostUsd > 0, `${entry.sku} has non-positive unitCostUsd`);
      assert.ok(Number.isFinite(entry.unitCostUsd), `${entry.sku} unitCostUsd is not finite`);
    }
  }
});

test("catalog has at least 90 SKUs", () => {
  assert.ok(CATALOG_SKUS.length >= 90, `only ${CATALOG_SKUS.length} SKUs in catalog`);
});

test("finish category entries cover paint, trim, and flooring", () => {
  const finishSkus = Object.values(CATALOG)
    .filter((e) => e.category === "finish")
    .map((e) => e.sku);
  assert.ok(finishSkus.some((s) => s.includes("PAINT")), "no paint SKU in finish");
  assert.ok(finishSkus.some((s) => s.includes("BASEBOARD")), "no baseboard SKU in finish");
  assert.ok(finishSkus.some((s) => s.includes("LVP")), "no LVP flooring SKU in finish");
});

test("fixture category covers toilet, water heater, and ceiling fan", () => {
  const fixSkus = Object.values(CATALOG)
    .filter((e) => e.category === "fixture")
    .map((e) => e.sku);
  assert.ok(fixSkus.includes("FIX-TOILET"), "FIX-TOILET missing");
  assert.ok(fixSkus.includes("FIX-WH-50"), "FIX-WH-50 missing");
  assert.ok(fixSkus.includes("FIX-FAN-CEIL"), "FIX-FAN-CEIL missing");
});

test("roofing category has ice+water, drip edge, house wrap", () => {
  const rooSkus = Object.values(CATALOG)
    .filter((e) => e.category === "roofing")
    .map((e) => e.sku);
  assert.ok(rooSkus.includes("ROO-ICE-WATER"), "ROO-ICE-WATER missing");
  assert.ok(rooSkus.includes("ROO-DRIP-EDGE"), "ROO-DRIP-EDGE missing");
  assert.ok(rooSkus.includes("ROO-WRAP"), "ROO-WRAP missing");
});

test("expectedSkusForStage(finishes) returns only finish/fixture/hardware", () => {
  const entries = expectedSkusForStage("finishes");
  assert.ok(entries.length > 0, "no entries for finishes stage");
  for (const e of entries) {
    assert.ok(
      ["finish", "fixture", "hardware"].includes(e.category),
      `unexpected category ${e.category} for finishes stage`,
    );
  }
});

test("existing SKUs from original parts.ts are preserved", () => {
  const mustExist = [
    "LUM-2X4-92", "LUM-2X4-PLATE", "LUM-2X10-HDR", "SHT-OSB-716",
    "DRY-12-4X8", "DRY-MUD", "DRY-TAPE",
    "INS-R13-BATT", "INS-R38-BATT",
    "ELE-BOX-1G", "ELE-NM-12-2", "ELE-NM-14-2", "ELE-PLATE-NAIL",
    "PLM-PEX-12", "PLM-PVC-3", "PLM-PVC-2",
    "HVA-DUCT-FLEX8", "HVA-BOOT",
    "CON-READYMIX", "CON-REBAR-4",
    "FAS-NAIL-16D", "FAS-SCREW-125",
    "ROO-SHINGLE", "ROO-UNDERLAY",
  ];
  for (const sku of mustExist) {
    assert.ok(CATALOG[sku] !== undefined, `preserved SKU ${sku} is missing`);
  }
});

// ─── Finishes takeoff math ────────────────────────────────────────────────────

test("finishes takeoff: paint gallons are mathematically correct", () => {
  // 1000 sf wall, 500 sf ceiling, 2 coats at 350 sf/gal/coat
  // wall gal = ceil(1000 * 2 / 350) = ceil(5.71) = 6
  // ceil gal = ceil(500 * 2 / 350) = ceil(2.86) = 3
  const r = recon();
  const lines = takeoffFromGeometry(r, "finishes");

  const wallPaint = lines.find((l) => l.sku === "FIN-PAINT-EGGSHELL");
  assert.ok(wallPaint, "FIN-PAINT-EGGSHELL missing from finishes takeoff");
  assert.equal(wallPaint.quantity, 6, `wall paint gal: expected 6, got ${wallPaint.quantity}`);
  assert.equal(wallPaint.basis, "measured");
  assert.match(wallPaint.derivation, /350 sf per gal/);

  const ceilPaint = lines.find((l) => l.sku === "FIN-PAINT-CEILING");
  assert.ok(ceilPaint, "FIN-PAINT-CEILING missing from finishes takeoff");
  assert.equal(ceilPaint.quantity, 3, `ceiling paint gal: expected 3, got ${ceilPaint.quantity}`);
});

test("finishes takeoff: primer covers walls + ceiling at 400 sf/gal", () => {
  // (1000 + 500) / 400 = 3.75 → ceil = 4
  const lines = takeoffFromGeometry(recon(), "finishes");
  const primer = lines.find((l) => l.sku === "FIN-PRIMER-PVA");
  assert.ok(primer, "FIN-PRIMER-PVA missing");
  assert.equal(primer.quantity, 4, `primer gal: expected 4, got ${primer.quantity}`);
});

test("finishes takeoff: baseboard lf equals wall perimeter", () => {
  // wallAreaM2 = 92.9 / M2_PER_FT2 = ~1000 sf; height = 2.44/0.3048 = ~8ft
  // wallLf ≈ 1000 / 8 = 125 lf
  const lines = takeoffFromGeometry(recon(), "finishes");
  const baseboard = lines.find((l) => l.sku === "FIN-BASEBOARD");
  assert.ok(baseboard, "FIN-BASEBOARD missing");
  assert.ok(
    baseboard.quantity > 100 && baseboard.quantity < 150,
    `baseboard lf out of expected range: ${baseboard.quantity}`,
  );
  assert.equal(baseboard.basis, "measured");
});

test("finishes takeoff: LVP sf includes 10% waste", () => {
  const lines = takeoffFromGeometry(recon(), "finishes");
  const lvp = lines.find((l) => l.sku === "FIN-LVP");
  assert.ok(lvp, "FIN-LVP missing");
  // floorFt2 ≈ 500 sf * 1.1 = 550
  assert.ok(lvp.quantity >= 550, `LVP sf should be ≥550 with waste, got ${lvp.quantity}`);
  assert.match(lvp.derivation, /10% waste/);
});

test("assumed scale discounts finishes paint confidence", () => {
  const assumed = takeoffFromGeometry(recon({ scaleSource: "assumed" }), "finishes");
  const referenced = takeoffFromGeometry(recon({ scaleSource: "reference_object" }), "finishes");
  const aWall = assumed.find((l) => l.sku === "FIN-PAINT-EGGSHELL")!;
  const rWall = referenced.find((l) => l.sku === "FIN-PAINT-EGGSHELL")!;
  assert.ok(aWall.confidence < rWall.confidence, "assumed scale must reduce confidence");
  assert.match(aWall.derivation, /scale assumed/);
});

// ─── HVAC takeoff ─────────────────────────────────────────────────────────────

test("hvac takeoff: register count scales with floor area", () => {
  const small = takeoffFromGeometry(
    recon({}, { floorAreaM2: 46.4 }),
    "hvac",
  );
  const large = takeoffFromGeometry(
    recon({}, { floorAreaM2: 186 }), // ~2000 sf
    "hvac",
  );
  const smallBoots = small.find((l) => l.sku === "HVA-BOOT")!;
  const largeBoots = large.find((l) => l.sku === "HVA-BOOT")!;
  assert.ok(largeBoots.quantity > smallBoots.quantity, "larger floor needs more boots");
});

test("hvac takeoff includes thermostat at quantity 1", () => {
  const lines = takeoffFromGeometry(recon(), "hvac");
  const thermo = lines.find((l) => l.sku === "HVA-THERMO");
  assert.ok(thermo, "HVA-THERMO missing from hvac takeoff");
  assert.equal(thermo.quantity, 1);
  assert.equal(thermo.basis, "derived");
});

// ─── Site takeoff ─────────────────────────────────────────────────────────────

test("site takeoff produces vapor barrier and form stakes", () => {
  const lines = takeoffFromGeometry(recon(), "site");
  const vb = lines.find((l) => l.sku === "CON-VAPOR-BAR");
  const stakes = lines.find((l) => l.sku === "CON-FORM-STAKE");
  assert.ok(vb, "CON-VAPOR-BAR missing from site takeoff");
  assert.ok(stakes, "CON-FORM-STAKE missing from site takeoff");
  assert.ok(vb.quantity >= 1);
  assert.ok(stakes.quantity >= 4);
});

// ─── Rough electrical takeoff ─────────────────────────────────────────────────

test("rough_electrical takeoff includes boxes, receptacles, and nail plates", () => {
  const lines = takeoffFromGeometry(recon(), "rough_electrical");
  const box = lines.find((l) => l.sku === "ELE-BOX-1G");
  const recep = lines.find((l) => l.sku === "ELE-RECEP");
  const plate = lines.find((l) => l.sku === "ELE-PLATE-NAIL");
  assert.ok(box, "ELE-BOX-1G missing");
  assert.ok(recep, "ELE-RECEP missing");
  assert.ok(plate, "ELE-PLATE-NAIL missing");
  // Receptacles should be ~70% of boxes
  assert.ok(
    recep.quantity <= box.quantity,
    `receptacles (${recep.quantity}) must not exceed boxes (${box.quantity})`,
  );
  assert.match(box.derivation, /NEC/);
});

test("rough_electrical: 12-2 and 14-2 cable both present", () => {
  const lines = takeoffFromGeometry(recon(), "rough_electrical");
  assert.ok(lines.find((l) => l.sku === "ELE-NM-12-2"), "ELE-NM-12-2 missing");
  assert.ok(lines.find((l) => l.sku === "ELE-NM-14-2"), "ELE-NM-14-2 missing");
});

// ─── Rough plumbing takeoff ───────────────────────────────────────────────────

test("rough_plumbing takeoff includes PEX, 3in and 2in DWV, and nail plates", () => {
  const lines = takeoffFromGeometry(recon(), "rough_plumbing");
  const pex = lines.find((l) => l.sku === "PLM-PEX-12");
  const dwv3 = lines.find((l) => l.sku === "PLM-PVC-3");
  const dwv2 = lines.find((l) => l.sku === "PLM-PVC-2");
  const plate = lines.find((l) => l.sku === "ELE-PLATE-NAIL");
  assert.ok(pex, "PLM-PEX-12 missing");
  assert.ok(dwv3, "PLM-PVC-3 missing");
  assert.ok(dwv2, "PLM-PVC-2 missing");
  assert.ok(plate, "ELE-PLATE-NAIL missing from rough_plumbing");
  assert.ok(pex.quantity > 0);
  assert.ok(dwv3.quantity > 0);
  assert.ok(dwv2.quantity > 0);
});

// ─── detectionToPartLine ──────────────────────────────────────────────────────

test("detectionToPartLine: known SKU maps to PartLine with correct fields", () => {
  const detection = ExactDetection.parse({
    sku: "ELE-GFCI",
    quantity: 4,
    confidence: 0.82,
    reasoning: "four GFCI receptacles visible in frames 1 and 3",
  });
  const pl = detectionToPartLine(detection, "rough_electrical");
  assert.ok(pl !== null, "should produce a PartLine");
  assert.equal(pl.sku, "ELE-GFCI");
  assert.equal(pl.quantity, 4);
  assert.equal(pl.basis, "detected");
  assert.equal(pl.stage, "rough_electrical");
  assert.equal(pl.category, "electrical");
  assert.ok(pl.unitCostUsd !== undefined);
});

test("detectionToPartLine: identified field passes through untouched", () => {
  const detection = ExactDetection.parse({
    sku: "FIN-PAINT-EGGSHELL",
    quantity: 2,
    confidence: 0.9,
    reasoning: "two gallon cans visible on shelf in frame 2",
    identified: {
      manufacturer: "Behr",
      model: "Premium Plus Ultra",
      color: "Swiss Coffee W-F-110",
      finish: "eggshell",
      size: "1 GAL",
      readFrom: "paint-can label in frame 2",
    },
  });
  const pl = detectionToPartLine(detection, "finishes");
  assert.ok(pl !== null);
  assert.deepEqual(pl.identified, {
    manufacturer: "Behr",
    model: "Premium Plus Ultra",
    color: "Swiss Coffee W-F-110",
    finish: "eggshell",
    size: "1 GAL",
    readFrom: "paint-can label in frame 2",
  });
});

test("detectionToPartLine: unknown SKU returns null", () => {
  const detection = ExactDetection.parse({
    sku: "FAKE-NOT-REAL",
    quantity: 3,
    confidence: 0.5,
    reasoning: "seen something",
  });
  const pl = detectionToPartLine(detection, "finishes");
  assert.equal(pl, null, "unknown SKU must be dropped");
});

test("detectionToPartLine: zero quantity returns null", () => {
  const detection = ExactDetection.parse({
    sku: "ELE-GFCI",
    quantity: 0,
    confidence: 0.9,
    reasoning: "counted zero",
  });
  const pl = detectionToPartLine(detection, "rough_electrical");
  assert.equal(pl, null, "zero quantity must be dropped");
});

test("detectionToPartLine: confidence is clamped to [0, 1]", () => {
  const detection = ExactDetection.parse({
    sku: "ELE-RECEP",
    quantity: 2,
    confidence: 1.5,
    reasoning: "very confident",
  });
  const pl = detectionToPartLine(detection, "rough_electrical");
  assert.ok(pl !== null);
  assert.ok(pl.confidence <= 1, `confidence ${pl.confidence} exceeds 1`);
  assert.ok(pl.confidence >= 0);
});

// ─── buildPartsIdPrompt ───────────────────────────────────────────────────────

test("buildPartsIdPrompt returns a non-empty string with stage catalog entries", () => {
  const geometry = recon().geometry;
  const prompt = buildPartsIdPrompt("finishes", geometry);
  assert.ok(typeof prompt === "string");
  assert.ok(prompt.length > 100);
  // Should include at least one finish SKU
  assert.ok(prompt.includes("FIN-"), "prompt must include finish SKUs");
  // Must mention the identification protocol
  assert.ok(prompt.includes("EXACT IDENTIFICATION"), "prompt must include id protocol header");
  // Must include the DO NOT rules
  assert.ok(prompt.includes("DO NOT"), "prompt must include DO NOT rules");
});

test("buildPartsIdPrompt embeds floor and wall area for context", () => {
  const geometry = recon().geometry;
  const prompt = buildPartsIdPrompt("rough_electrical", geometry);
  // Should reference the measured areas
  assert.ok(prompt.includes("1000") || prompt.includes("sf"), "prompt must reference measured area");
});

// ─── cumulativeParts supersede (regression guard) ─────────────────────────────

test("cumulativeParts: measured later-stage line supersedes earlier detected line", () => {
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
    {
      ...early[0],
      id: "insulation:LUM-2X4-92",
      quantity: 97,
      basis: "measured",
      stage: "insulation",
      derivation: "measured from geometry",
    },
  ];

  const rolled = cumulativeParts([
    { stage: "framing", parts: early },
    { stage: "insulation", parts: later },
  ]);

  assert.equal(rolled.length, 1, "same SKU must not appear twice");
  assert.equal(rolled[0].quantity, 97, "measured count must win");
  assert.match(rolled[0].derivation, /supersedes framing/);
});

test("cumulativeParts: same SKU twice in one stage sums quantities", () => {
  const base: PartLine = {
    id: "finishes:FIN-LVP",
    sku: "FIN-LVP",
    name: "Luxury vinyl plank",
    category: "finish",
    quantity: 300,
    unit: "sf",
    basis: "measured",
    derivation: "first room",
    confidence: 0.8,
    stage: "finishes",
  };

  const rolled = cumulativeParts([
    { stage: "finishes", parts: [base, { ...base, quantity: 200, derivation: "second room" }] },
  ]);

  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].quantity, 500);
});

test("cumulativeParts: new finish SKUs sort alongside existing categories", () => {
  const finishLine: PartLine = {
    id: "finishes:FIN-BASEBOARD",
    sku: "FIN-BASEBOARD",
    name: "Colonial baseboard 3-1/4in",
    category: "finish",
    quantity: 120,
    unit: "lf",
    basis: "measured",
    derivation: "perimeter",
    confidence: 0.75,
    stage: "finishes",
  };
  const lumberLine: PartLine = {
    id: "framing:LUM-2X4-92",
    sku: "LUM-2X4-92",
    name: "2x4 stud",
    category: "lumber",
    quantity: 80,
    unit: "ea",
    basis: "measured",
    derivation: "counted",
    confidence: 0.8,
    stage: "framing",
  };

  const rolled = cumulativeParts([
    { stage: "framing", parts: [lumberLine] },
    { stage: "finishes", parts: [finishLine] },
  ]);

  assert.equal(rolled.length, 2);
  // finish comes before lumber alphabetically
  assert.equal(rolled[0].category, "finish");
  assert.equal(rolled[1].category, "lumber");
});

// ─── partFromDetection (existing export, still works) ─────────────────────────

test("partFromDetection resolves a known SKU and drops an unknown one", () => {
  const known = partFromDetection("FIX-TOILET", 2, 0.75, "two toilets in frame 5", "finishes");
  assert.ok(known !== null);
  assert.equal(known.sku, "FIX-TOILET");
  assert.equal(known.basis, "detected");

  const unknown = partFromDetection("XYZ-GHOST", 1, 0.9, "phantom item", "finishes");
  assert.equal(unknown, null);
});
