/**
 * The 50-point ledger — integrity of the ledger itself, and the deterministic
 * evaluators, with no network.
 *
 *   npm test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHECKPOINTS,
  checkpointsForStage,
  evaluateCheckpoints,
  visionCheckpointsForStage,
  visionCheckpointPrompt,
} from "../src/lib/checkpoints";
import { STAGE_IDS } from "../src/lib/stages";
import type { ReconResult } from "../src/lib/types";

function recon(
  metricsOver: Partial<ReconResult["metrics"]> = {},
  geometryOver: Partial<ReconResult["geometry"]> = {},
): ReconResult {
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
      scaleSource: "stud_spacing",
      glbBytes: 3_000_000,
      ...metricsOver,
    },
    geometry: {
      boundingBoxM: [8, 2.44, 6],
      floorAreaM2: 46.4,
      wallAreaM2: 92.9,
      ceilingHeightM: 2.44,
      planes: [
        { kind: "floor", areaM2: 46, deviationDeg: 0.2, flatnessMm: 3 },
        { kind: "wall", areaM2: 20, deviationDeg: 0.3, flatnessMm: 2.5 },
        { kind: "wall", areaM2: 18, deviationDeg: 0.4, flatnessMm: 3 },
      ],
      studSpacingIn: 16.1,
      studSpacingCv: 0.03,
      ...geometryOver,
    },
  };
}

test("the ledger is exactly fifty, sequential, unique", () => {
  assert.equal(CHECKPOINTS.length, 50);
  const ids = new Set(CHECKPOINTS.map((c) => c.id));
  assert.equal(ids.size, 50);
  CHECKPOINTS.forEach((c, i) => {
    assert.equal(c.num, i + 1);
    assert.equal(c.id, `QC-${String(i + 1).padStart(2, "0")}`);
    assert.ok(c.standard.length > 10, `${c.id} has a real standard`);
    assert.ok(c.longevity.length > 10, `${c.id} has a real longevity note`);
    assert.ok(c.stages.length > 0, `${c.id} applies somewhere`);
  });
});

test("every stage carries capture points and at least one judged point", () => {
  for (const stage of STAGE_IDS) {
    const defs = checkpointsForStage(stage);
    assert.ok(defs.length >= 6, `${stage} carries ${defs.length} points`);
    assert.ok(
      defs.some((d) => d.source === "capture"),
      `${stage} checks capture integrity`,
    );
    assert.ok(
      visionCheckpointsForStage(stage).length >= 1,
      `${stage} has judged points`,
    );
    assert.ok(visionCheckpointPrompt(stage).includes("QC-"), `${stage} prompt lists ids`);
  }
});

test("a clean reconstruction passes the measured points", () => {
  const evaln = evaluateCheckpoints(recon(), "framing", []);
  const byId = new Map(evaln.results.map((r) => [r.id, r]));
  for (const id of ["QC-01", "QC-02", "QC-03", "QC-04", "QC-05", "QC-06", "QC-07", "QC-08", "QC-09"]) {
    assert.equal(byId.get(id)?.status, "pass", `${id} should pass`);
  }
  assert.equal(evaln.applicable, checkpointsForStage("framing").length);
});

test("bad measurements fail the matching points, with evidence", () => {
  const evaln = evaluateCheckpoints(
    recon(
      { framesRegistered: 20, framesSubmitted: 60, scaleSource: "assumed" },
      {
        planes: [
          { kind: "wall", areaM2: 20, deviationDeg: 3.5, flatnessMm: 14 },
          { kind: "floor", areaM2: 46, deviationDeg: 0.2, flatnessMm: 3 },
        ],
        studSpacingIn: 17.8,
        studSpacingCv: 0.12,
      },
    ),
    "framing",
    [],
  );
  const byId = new Map(evaln.results.map((r) => [r.id, r]));
  assert.equal(byId.get("QC-01")?.status, "fail");
  assert.equal(byId.get("QC-04")?.status, "attention");
  assert.equal(byId.get("QC-06")?.status, "fail");
  assert.equal(byId.get("QC-08")?.status, "fail");
  assert.equal(byId.get("QC-09")?.status, "fail");
  for (const r of evaln.results) {
    assert.ok(r.evidence.length > 0, `${r.id} carries evidence`);
  }
});

test("missing geometry reads not_assessable, never pass", () => {
  const evaln = evaluateCheckpoints(
    recon({}, { planes: [], studSpacingIn: null, studSpacingCv: null }),
    "framing",
    [],
  );
  const byId = new Map(evaln.results.map((r) => [r.id, r]));
  for (const id of ["QC-06", "QC-07", "QC-08", "QC-09"]) {
    assert.equal(byId.get(id)?.status, "not_assessable", id);
  }
});

test("vision verdicts land on their points; absent verdicts stay unassessed", () => {
  const evaln = evaluateCheckpoints(recon(), "framing", [
    { id: "QC-10", status: "pass", evidence: "double 2x10 header on two jacks, frame 3", frameIndex: 3 },
    { id: "QC-12", status: "fail", evidence: "stud bored past 60% at plumbing run, frame 5", frameIndex: 5 },
    { id: "QC-99", status: "pass", evidence: "not a real checkpoint" },
  ]);
  const byId = new Map(evaln.results.map((r) => [r.id, r]));
  assert.equal(byId.get("QC-10")?.status, "pass");
  assert.equal(byId.get("QC-10")?.keyframeIndex, 3);
  assert.equal(byId.get("QC-12")?.status, "fail");
  assert.equal(byId.get("QC-11")?.status, "not_assessable");
  assert.equal(byId.has("QC-99"), false);
});

test("counts add up and unavailable vision explains itself", () => {
  const reason = "The footage does not show this construction stage.";
  const evaln = evaluateCheckpoints(recon(), "drywall", [], reason);
  assert.equal(evaln.applicable, checkpointsForStage("drywall").length);
  assert.equal(
    evaln.assessed,
    evaln.results.filter((r) => r.status !== "not_assessable").length,
  );
  assert.ok(evaln.passed <= evaln.assessed);
  const judged = evaln.results.filter((r) => r.source === "vision");
  assert.ok(judged.length > 0);
  for (const r of judged) {
    assert.equal(r.status, "not_assessable");
    assert.equal(r.evidence, reason);
  }
});
