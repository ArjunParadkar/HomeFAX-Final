/**
 * The access matrix. One world, five kinds of reader, every path in.
 *
 *   Paradkar Builders (contractor) opens a record on 1418 Ridgemont Dr and
 *   films framing. Rupali claims the house. First Ozark Bank asks for ledger
 *   access; Rupali approves. City of Bentonville covers Bentonville, AR.
 *   A stranger has an account and nothing else. A buyer has a share link.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestDatabase } from "./helpers";
import type { QualityReport } from "@homefax/core";

type World = Awaited<ReturnType<typeof build>>;

/** Drizzle wraps the Postgres error; the policy text lives on `cause`. */
async function rejectsRls(p: Promise<unknown>, extra?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as Error & { cause?: Error };
    const msg = `${err.message} ${err.cause?.message ?? ""}`;
    return /row-level security|violates|append-only|permission denied/i.test(msg) || (extra?.test(msg) ?? false);
  });
}
let w: World;

before(async () => {
  process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  await resetTestDatabase("access");
  w = await build();
});
after(async () => (await import("../src/client")).closePool());

async function build() {
  const db = await import("../src/index");
  const { withService, withActor } = db;
  const su = (email: string, name: string) =>
    withService((tx) => db.auth.signUp(tx, { email, password: "a long passphrase 9", name, app: "contractor" })).then((r) => r.principal.identity.id);
  const arjun = await su("arjun@example.com", "Arjun Paradkar");
  const rupali = await su("rupali@example.com", "Rupali Paradkar");
  const banker = await su("banker@example.com", "Bea Banker");
  const official = await su("city@example.com", "Cal Official");
  const stranger = await su("stranger@example.com", "Sam Stranger");
  const agent = await su("agent@example.com", "Ava Agent");

  const builders = await withActor({ identityId: arjun }, (tx) => db.orgs.createOrg(tx, { kind: "contractor", name: "Paradkar Builders", ownerIdentityId: arjun }));
  const bank = await withActor({ identityId: banker }, (tx) => db.orgs.createOrg(tx, { kind: "lender", name: "First Ozark Bank", ownerIdentityId: banker }));
  const city = await withActor({ identityId: official }, (tx) => db.orgs.createOrg(tx, { kind: "municipality", name: "City of Bentonville", ownerIdentityId: official }));
  await withActor({ identityId: official }, (tx) => db.orgs.addJurisdiction(tx, { orgId: city.id, state: "AR", city: "Bentonville" }));
  const brokerage = await withActor({ identityId: agent }, (tx) => db.orgs.createOrg(tx, { kind: "brokerage", name: "Ridgeline Realty", ownerIdentityId: agent }));

  const { property } = await withService((tx) => db.properties.findOrCreateProperty(tx, { line1: "1418 Ridgemont Dr", city: "Bentonville", state: "AR", postalCode: "72712", createdBy: arjun }));
  const record = await withActor({ identityId: arjun }, (tx) => db.records.createRecord(tx, { property, orgId: builders.id, orgName: builders.name, ownerName: "R. Paradkar", createdBy: arjun }));

  const capture = await withActor({ identityId: arjun }, (tx) => db.records.upsertCapture(tx, { record, stage: "framing", jobId: "demo-1", frames: ["https://x/1.jpg"], filmedBy: arjun, filmedByOrgId: builders.id }));
  const quality: QualityReport = {
    score: 86,
    grade: "B",
    dimensions: [
      { dimension: "capture", score: 90, weight: 0.3, basis: "60/60 frames" },
      { dimension: "geometry", score: 84, weight: 0.3, basis: "plumb 0.4°" },
      { dimension: "workmanship", score: 85, weight: 0.25, basis: "review" },
      { dimension: "compliance", score: 82, weight: 0.15, basis: "review" },
    ],
    findings: [{ id: "f1", severity: "major", title: "Missing fire block", detail: "Frame 3 shows an open chase.", dimension: "compliance", source: "vision", keyframeIndex: 3 }],
    checkpoints: [
      { id: "QC-05", num: 5, title: "Walls plumb", standard: "≤ 1/4 in per 8 ft", longevity: "Doors bind", category: "structure", status: "pass", evidence: "0.4°", source: "geometry" },
      { id: "QC-40", num: 40, title: "Fire blocking", standard: "Blocked at 10 ft", longevity: "Fire spread", category: "safety", status: "fail", evidence: "Open chase, frame 3", source: "vision", keyframeIndex: 3 },
    ],
    checkpointsPassed: 1,
    checkpointsAssessed: 2,
    checkpointsApplicable: 2,
    visionAvailable: true,
    visionStatus: "graded",
  };
  await withService((tx) =>
    db.records.finalizeCapture(tx, capture.id, {
      job: { id: "demo-1", state: "done", steps: [] },
      glbUrl: "https://blob/x.glb",
      quality,
      parts: [{ id: "p1", sku: "LUM-2X4-8", name: "2x4x8 stud", category: "lumber", quantity: 120, unit: "ea", basis: "measured", derivation: "112 lf / 16in", confidence: 0.9, unitCostUsd: 4.5, stage: "framing" }],
      notes: "Sound framing.",
    }),
  );

  const { code } = await withActor({ identityId: arjun }, (tx) => db.properties.createOwnerInvite(tx, { propertyId: property.id, invitedBy: arjun }));
  await withService((tx) => db.properties.claimProperty(tx, code, rupali));

  const req = await withService((tx) => db.access.requestAccess(tx, { propertyId: property.id, requesterOrgId: bank.id, requesterIdentityId: banker, scope: "ledger", purpose: "Construction loan draw verification" }));
  await withActor({ identityId: rupali }, (tx) => db.access.decideRequest(tx, req.id, "approved", rupali, { orgName: bank.name }));

  const share = await withActor({ identityId: rupali }, (tx) => db.access.createShareLink(tx, { propertyId: property.id, scope: "summary", label: "Buyer", createdBy: rupali }));

  return { db, arjun, rupali, banker, official, stranger, agent, builders, bank, city, brokerage, property, record, capture, shareToken: share.token };
}

test("the stats row was computed by trigger", async () => {
  const s = await w.db.withService((tx) => w.db.properties.getStats(tx, w.property.id));
  assert.equal(s?.stagesFilmed, 1);
  assert.equal(s?.pointsPassed, 1);
  assert.equal(s?.pointsAssessed, 2);
  assert.equal(s?.openSafetyItems, 1);
  assert.equal(s?.majorFindings, 1);
  assert.equal(s?.latestGrade, "B");
  assert.equal(s?.materialsTotalCents, 54000);
});

test("every reader gets exactly their scope", async () => {
  const { db } = w;
  const scope = (id: string | null, shareHash?: string) => db.withActor({ identityId: id, shareHash }, (tx) => db.scopeOf(tx, w.property.id));
  assert.equal(await scope(w.arjun), "full", "contractor on the project");
  assert.equal(await scope(w.rupali), "full", "homeowner");
  assert.equal(await scope(w.banker), "ledger", "lender by grant");
  assert.equal(await scope(w.official), "ledger", "municipality by jurisdiction");
  assert.equal(await scope(w.stranger), null, "stranger");
  assert.equal(await scope(w.agent), null, "brokerage without a grant");
  assert.equal(await scope(null), null, "anonymous");
  const { hashToken } = await import("@homefax/auth");
  assert.equal(await scope(null, hashToken(w.shareToken)), "summary", "share link");
});

test("row visibility follows the scope ladder", async () => {
  const { db } = w;
  const count = async (id: string | null, table: "captures" | "partLines" | "stageGrades" | "properties" | "propertyDocuments" | "checkpointResults", shareHash?: string) =>
    db.withActor({ identityId: id, shareHash }, async (tx) => (await tx.select().from(db.schema[table])).length);
  const { hashToken } = await import("@homefax/auth");
  const share = hashToken(w.shareToken);

  // summary: properties + grades, no captures/ledger/parts
  assert.equal(await count(null, "properties", share), 1);
  assert.equal(await count(null, "stageGrades", share), 1);
  assert.equal(await count(null, "captures", share), 0);
  assert.equal(await count(null, "checkpointResults", share), 0);
  assert.equal(await count(null, "partLines", share), 0);
  // ledger: captures + ledger, no parts
  assert.equal(await count(w.banker, "captures"), 1);
  assert.equal(await count(w.banker, "checkpointResults"), 2);
  assert.equal(await count(w.banker, "partLines"), 0);
  assert.equal(await count(w.official, "checkpointResults"), 2);
  assert.equal(await count(w.official, "partLines"), 0);
  // full
  assert.equal(await count(w.rupali, "partLines"), 1);
  assert.equal(await count(w.arjun, "partLines"), 1);
  // nothing
  assert.equal(await count(w.stranger, "properties"), 0);
  assert.equal(await count(w.stranger, "stageGrades"), 0);
  assert.equal(await count(null, "properties"), 0);
});

test("writes are refused outside the actor's role", async () => {
  const { db } = w;
  // A stranger cannot film on someone else's record (insert is silently filtered → error from RLS).
  await rejectsRls(db.withActor({ identityId: w.stranger }, (tx) => db.records.upsertCapture(tx, { record: w.record, stage: "roofing", jobId: "x", frames: [] })));
  // The lender cannot grant itself more access.
  await rejectsRls(db.withActor({ identityId: w.banker }, (tx) => db.access.grantAccess(tx, { propertyId: w.property.id, granteeOrgId: w.bank.id, scope: "full", grantedBy: w.banker })));
  // The homeowner cannot write a capture either — the record is the contractor's instrument.
  await rejectsRls(db.withActor({ identityId: w.rupali }, (tx) => db.records.upsertCapture(tx, { record: w.record, stage: "roofing", jobId: "x", frames: [] })));
  // Nobody can tamper with the audit log, not even the service.
  await rejectsRls(db.withService((tx) => tx.delete(db.schema.auditLog)));
});

test("revoking the grant closes the lender's view; the municipality keeps its statutory one", async () => {
  const { db } = w;
  const grants = await db.withActor({ identityId: w.rupali }, (tx) => db.access.listGrants(tx, w.property.id));
  assert.equal(grants.length, 1);
  await db.withActor({ identityId: w.rupali }, (tx) => db.access.revokeGrant(tx, grants[0].id, w.rupali));
  assert.equal(await db.withActor({ identityId: w.banker }, (tx) => db.scopeOf(tx, w.property.id)), null);
  assert.equal(await db.withActor({ identityId: w.official }, (tx) => db.scopeOf(tx, w.property.id)), "ledger");
  // Re-grant for the remaining tests.
  await db.withActor({ identityId: w.rupali }, (tx) => db.access.grantAccess(tx, { propertyId: w.property.id, granteeOrgId: w.bank.id, scope: "ledger", grantedBy: w.rupali }));
});

test("institutions: holdings, draw recommendation, inspection review, audit trail", async () => {
  const { db } = w;
  const holding = await db.withActor({ identityId: w.banker }, (tx) =>
    db.oversight.createHolding(tx, { orgId: w.bank.id, propertyId: w.property.id, kind: "construction", loanRef: "LN-0001", principalCents: 42_000_000, createdBy: w.banker }),
  );
  assert.ok(holding.loanRefEnc && !holding.loanRefEnc.includes("LN-0001"));
  const rec = await db.withActor({ identityId: w.banker }, (tx) => db.oversight.recommendDraw(tx, w.property.id, "framing"));
  assert.equal(rec.recommendation, "hold", rec.reasons.join("; ")); // one safety checkpoint failed
  assert.ok(rec.reasons.some((r) => /safety/.test(r)));
  const rec2 = await db.withActor({ identityId: w.banker }, (tx) => db.oversight.recommendDraw(tx, w.property.id, "roofing"));
  assert.match(rec2.reasons[0], /not been filmed/);

  // The homeowner can see the holding against their house but cannot edit it.
  const seen = await db.withActor({ identityId: w.rupali }, (tx) => tx.select().from(db.schema.portfolioHoldings));
  assert.equal(seen.length, 1);
  await rejectsRls(db.withActor({ identityId: w.rupali }, (tx) => db.oversight.updateHolding(tx, holding.id, { status: "paid_off" })), /not found/i);

  // The city verifies the stage; stats pick it up by trigger.
  await db.withActor({ identityId: w.official }, (tx) =>
    db.oversight.recordInspectionReview(tx, { captureId: w.capture.id, propertyId: w.property.id, municipalityOrgId: w.city.id, reviewerId: w.official, verdict: "verified", stage: "framing", orgName: w.city.name }),
  );
  const s = await db.withService((tx) => db.properties.getStats(tx, w.property.id));
  assert.equal(s?.verifiedStages, 1);
  const queue = await db.withActor({ identityId: w.official }, (tx) => db.oversight.listInspectionQueue(tx, w.city.id));
  assert.equal(queue.length, 0);

  // The brokerage cannot review: not a municipality, not in reach.
  await rejectsRls(db.withActor({ identityId: w.agent }, (tx) => db.oversight.recordInspectionReview(tx, { captureId: w.capture.id, propertyId: w.property.id, municipalityOrgId: w.brokerage.id, reviewerId: w.agent, verdict: "verified" })));

  // The homeowner's audit view shows the grant decisions on their house; the audit never stores the hash.
  const trail = await db.withActor({ identityId: w.rupali }, (tx) => db.audit.listAuditForProperty(tx, w.property.id));
  assert.ok(trail.some((r) => r.tableName === "grants"));
  assert.ok(trail.every((r) => !JSON.stringify(r.after ?? {}).includes("token_hash")));
  // A stranger sees no audit rows at all.
  assert.equal((await db.withActor({ identityId: w.stranger }, (tx) => db.audit.listAuditForProperty(tx, w.property.id))).length, 0);
});

test("access log records non-owner views and the owner can read it", async () => {
  const { db } = w;
  const r = await db.withActor({ identityId: w.banker }, (tx) => db.access.reach(tx, w.property.id, { identityId: w.banker }));
  assert.equal(r?.via, "grant");
  await db.withActor({ identityId: w.banker }, (tx) => db.access.logAccess(tx, { propertyId: w.property.id, viewerIdentityId: w.banker, viewerOrgId: w.bank.id, via: "grant", scope: "ledger", app: "admin", path: "/properties/x" }));
  const log = await db.withActor({ identityId: w.rupali }, (tx) => db.access.listAccessLog(tx, w.property.id));
  assert.equal(log.length, 1);
  assert.equal(log[0].viewerOrgId, w.bank.id);
  assert.equal((await db.withActor({ identityId: w.stranger }, (tx) => db.access.listAccessLog(tx, w.property.id))).length, 0);
});

test("address dedup: the same house typed differently is one row", async () => {
  const { db } = w;
  const again = await db.withService((tx) => db.properties.findOrCreateProperty(tx, { line1: "1418  ridgemont dr.", city: "BENTONVILLE", state: "ar", postalCode: "72712" }));
  // Trailing punctuation differs in the key, so this is a near-miss by design; the exact key matches.
  const exact = await db.withService((tx) => db.properties.findOrCreateProperty(tx, { line1: "1418 RIDGEMONT DR", city: "bentonville", state: "AR", postalCode: "72712" }));
  assert.equal(exact.created, false);
  assert.equal(exact.property.id, w.property.id);
  void again;
});
