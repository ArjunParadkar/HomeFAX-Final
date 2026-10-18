import { and, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { StageId } from "@homefax/core";
import { stageDef, toGrade } from "@homefax/core";
import { decryptField, encryptField, fieldCryptoConfigured } from "@homefax/auth";
import type { Tx } from "../client";
import { newId } from "../ids";
import { captures, checkpointResults, findings, stageGrades, type Capture, type StageGrade } from "../schema/build";
import { jurisdictions, memberships, organizations } from "../schema/org";
import { properties, propertyStats, type Property, type PropertyStats } from "../schema/property";
import {
  inspectionReviews,
  listings,
  loanDraws,
  permits,
  policies,
  portfolioHoldings,
  type InspectionReview,
  type Listing,
  type LoanDraw,
  type Permit,
  type Policy,
  type PortfolioHolding,
} from "../schema/oversight";
import { addEvent } from "./properties";

export type WithProperty<T> = { row: T; property: Property; stats: PropertyStats };

function enc(v: string | null | undefined): string | null {
  if (!v?.trim()) return null;
  if (!fieldCryptoConfigured()) throw new Error("PII_ENCRYPTION_KEY is not set — reference numbers cannot be stored");
  return encryptField(v.trim());
}
export function dec(v: string | null): string | null {
  if (!v) return null;
  try {
    return decryptField(v);
  } catch {
    return "••••";
  }
}

/* ------------------------------ risk model ------------------------------ */

/**
 * The institutional read of a house, from its stats row. Deterministic and
 * explainable: every point comes from a named fact on the record.
 */
export type RiskBand = "low" | "moderate" | "elevated" | "high" | "unknown";
export type RiskProfile = { band: RiskBand; score: number | null; reasons: string[] };

export function riskProfile(s: PropertyStats): RiskProfile {
  if (s.stagesFilmed === 0 || s.meanScore == null) return { band: "unknown", score: null, reasons: ["No stage has been filmed yet"] };
  const reasons: string[] = [];
  let score = s.meanScore;
  if (s.criticalFindings > 0) {
    score -= 15 * s.criticalFindings;
    reasons.push(`${s.criticalFindings} critical finding${s.criticalFindings === 1 ? "" : "s"} open`);
  }
  if (s.openSafetyItems > 0) {
    score -= 4 * s.openSafetyItems;
    reasons.push(`${s.openSafetyItems} safety point${s.openSafetyItems === 1 ? "" : "s"} failing or flagged`);
  }
  if (s.openMoistureItems > 0) {
    score -= 3 * s.openMoistureItems;
    reasons.push(`${s.openMoistureItems} moisture point${s.openMoistureItems === 1 ? "" : "s"} failing or flagged`);
  }
  if (s.flaggedStages > 0) {
    score -= 10 * s.flaggedStages;
    reasons.push(`${s.flaggedStages} stage${s.flaggedStages === 1 ? "" : "s"} flagged by the municipality`);
  }
  if (s.pointsAssessed > 0) {
    const passRate = s.pointsPassed / s.pointsAssessed;
    reasons.unshift(`${s.pointsPassed} of ${s.pointsAssessed} ledger points passed`);
    if (passRate < 0.7) score -= 10;
  }
  reasons.unshift(`Mean stage score ${Math.round(s.meanScore)}/100 over ${s.stagesFilmed} stage${s.stagesFilmed === 1 ? "" : "s"}`);
  score = Math.max(0, Math.min(100, score));
  const band: RiskBand = score >= 85 ? "low" : score >= 70 ? "moderate" : score >= 55 ? "elevated" : "high";
  return { band, score: Math.round(score), reasons };
}

/* ------------------------------- holdings ------------------------------- */

export async function listHoldings(tx: Tx, orgId: string): Promise<WithProperty<PortfolioHolding>[]> {
  const rows = await tx
    .select({ row: portfolioHoldings, property: properties, stats: propertyStats })
    .from(portfolioHoldings)
    .innerJoin(properties, eq(properties.id, portfolioHoldings.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(eq(portfolioHoldings.orgId, orgId))
    .orderBy(desc(portfolioHoldings.createdAt));
  return rows;
}
export async function getHolding(tx: Tx, id: string): Promise<PortfolioHolding | null> {
  return (await tx.select().from(portfolioHoldings).where(eq(portfolioHoldings.id, id)).limit(1))[0] ?? null;
}
export async function createHolding(
  tx: Tx,
  input: { orgId: string; propertyId: string; kind: PortfolioHolding["kind"]; loanRef?: string | null; principalCents: number; rateBps?: number | null; originatedAt?: string | null; maturesAt?: string | null; status?: PortfolioHolding["status"]; notes?: string | null; createdBy: string },
): Promise<PortfolioHolding> {
  if (!(input.principalCents >= 0)) throw new Error("Principal must be a non-negative amount");
  const [row] = await tx
    .insert(portfolioHoldings)
    .values({
      id: newId(),
      orgId: input.orgId,
      propertyId: input.propertyId,
      kind: input.kind,
      loanRefEnc: enc(input.loanRef),
      principalCents: input.principalCents,
      rateBps: input.rateBps ?? null,
      originatedAt: input.originatedAt ?? null,
      maturesAt: input.maturesAt ?? null,
      status: input.status ?? "active",
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}
export async function updateHolding(tx: Tx, id: string, patch: Partial<Pick<PortfolioHolding, "status" | "notes" | "principalCents" | "rateBps" | "maturesAt">> & { loanRef?: string | null }): Promise<PortfolioHolding> {
  const { loanRef, ...rest } = patch;
  const set: Partial<PortfolioHolding> = { ...rest };
  if (loanRef !== undefined) set.loanRefEnc = enc(loanRef);
  const [row] = await tx.update(portfolioHoldings).set(set).where(eq(portfolioHoldings.id, id)).returning();
  if (!row) throw new Error("Holding not found");
  return row;
}
export async function deleteHolding(tx: Tx, id: string): Promise<void> {
  await tx.delete(portfolioHoldings).where(eq(portfolioHoldings.id, id));
}

/* --------------------------------- draws -------------------------------- */

export type DrawRecommendation = { recommendation: "release" | "hold"; basisCaptureId: string | null; reasons: string[]; grade: StageGrade["grade"] | null; score: number | null };

/** What the record says about funding this stage. The lender decides; this explains. */
export async function recommendDraw(tx: Tx, propertyId: string, stage: StageId): Promise<DrawRecommendation> {
  const cap = (await tx.select().from(captures).where(and(eq(captures.propertyId, propertyId), eq(captures.stage, stage))).limit(1))[0];
  if (!cap) return { recommendation: "hold", basisCaptureId: null, reasons: [`${stageDef(stage).label} has not been filmed`], grade: null, score: null };
  if (cap.state !== "done") return { recommendation: "hold", basisCaptureId: cap.id, reasons: [`${stageDef(stage).label} is still being reconstructed`], grade: null, score: null };
  const grade = (await tx.select().from(stageGrades).where(eq(stageGrades.captureId, cap.id)).limit(1))[0];
  const crit = await tx.select({ n: sql<number>`count(*)` }).from(findings).where(and(eq(findings.captureId, cap.id), eq(findings.severity, "critical"), isNull(findings.resolvedAt)));
  const failedSafety = await tx
    .select({ n: sql<number>`count(*)` })
    .from(checkpointResults)
    .where(and(eq(checkpointResults.captureId, cap.id), eq(checkpointResults.category, "safety"), eq(checkpointResults.status, "fail")));
  const reasons: string[] = [];
  let release = true;
  if (!grade) {
    reasons.push("No grade on file for this stage");
    release = false;
  } else {
    reasons.push(`Stage graded ${grade.grade} (${Math.round(grade.score)}/100)`);
    if (grade.score < 70) {
      reasons.push("Score is below the 70-point funding floor");
      release = false;
    }
    if (grade.simulated) {
      reasons.push("Geometry is simulated — no real reconstruction was run");
      release = false;
    }
    if (grade.visionStatus !== "graded") reasons.push("Workmanship and compliance were not visually reviewed");
  }
  const nCrit = Number(crit[0]?.n ?? 0);
  if (nCrit > 0) {
    reasons.push(`${nCrit} critical finding${nCrit === 1 ? "" : "s"} unresolved`);
    release = false;
  }
  const nSafety = Number(failedSafety[0]?.n ?? 0);
  if (nSafety > 0) {
    reasons.push(`${nSafety} safety checkpoint${nSafety === 1 ? "" : "s"} failed`);
    release = false;
  }
  if (release) reasons.push("Nothing on the record blocks this draw");
  return { recommendation: release ? "release" : "hold", basisCaptureId: cap.id, reasons, grade: grade?.grade ?? null, score: grade?.score ?? null };
}

export async function requestDraw(tx: Tx, input: { holdingId: string; propertyId: string; stage: StageId; amountCents: number; requestedBy: string }): Promise<LoanDraw> {
  if (!(input.amountCents > 0)) throw new Error("Draw amount must be positive");
  const rec = await recommendDraw(tx, input.propertyId, input.stage);
  const [row] = await tx
    .insert(loanDraws)
    .values({
      id: newId(),
      holdingId: input.holdingId,
      propertyId: input.propertyId,
      stage: input.stage,
      amountCents: input.amountCents,
      basisCaptureId: rec.basisCaptureId,
      recommendation: `${rec.recommendation}: ${rec.reasons.join("; ")}`,
      requestedBy: input.requestedBy,
    })
    .returning();
  return row;
}

export type DrawRow = { draw: LoanDraw; holding: PortfolioHolding; property: Property };
export async function listDrawsForOrg(tx: Tx, orgId: string, status?: LoanDraw["status"][]): Promise<DrawRow[]> {
  const conds = [eq(portfolioHoldings.orgId, orgId)];
  if (status?.length) conds.push(inArray(loanDraws.status, status));
  return tx
    .select({ draw: loanDraws, holding: portfolioHoldings, property: properties })
    .from(loanDraws)
    .innerJoin(portfolioHoldings, eq(portfolioHoldings.id, loanDraws.holdingId))
    .innerJoin(properties, eq(properties.id, loanDraws.propertyId))
    .where(and(...conds))
    .orderBy(desc(loanDraws.requestedAt));
}
export async function listDrawsForProperty(tx: Tx, propertyId: string): Promise<LoanDraw[]> {
  return tx.select().from(loanDraws).where(eq(loanDraws.propertyId, propertyId)).orderBy(desc(loanDraws.requestedAt));
}
export async function decideDraw(tx: Tx, id: string, status: "verified" | "released" | "held" | "rejected", by: string, note?: string | null, orgName?: string): Promise<LoanDraw> {
  const [row] = await tx.update(loanDraws).set({ status, decidedBy: by, decidedAt: new Date(), decisionNote: note?.trim() || null }).where(eq(loanDraws.id, id)).returning();
  if (!row) throw new Error("Draw not found");
  await addEvent(tx, {
    propertyId: row.propertyId,
    kind: "draw_decided",
    title: `${stageDef(row.stage).label} draw ${status}${orgName ? ` by ${orgName}` : ""}`,
    detail: note ?? null,
    stage: row.stage,
    actorId: by,
    visibility: "full",
  });
  return row;
}

/* ------------------------------- policies ------------------------------- */

export async function listPolicies(tx: Tx, orgId: string): Promise<WithProperty<Policy>[]> {
  return tx
    .select({ row: policies, property: properties, stats: propertyStats })
    .from(policies)
    .innerJoin(properties, eq(properties.id, policies.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(eq(policies.orgId, orgId))
    .orderBy(desc(policies.createdAt));
}
export async function createPolicy(
  tx: Tx,
  input: { orgId: string; propertyId: string; kind: Policy["kind"]; policyRef?: string | null; coverageCents: number; premiumCents?: number | null; effectiveFrom: string; effectiveTo: string; status?: Policy["status"]; notes?: string | null; createdBy: string; orgName?: string },
): Promise<Policy> {
  if (!(input.coverageCents >= 0)) throw new Error("Coverage must be a non-negative amount");
  if (!(input.effectiveTo > input.effectiveFrom)) throw new Error("The policy must end after it starts");
  const [row] = await tx
    .insert(policies)
    .values({
      id: newId(),
      orgId: input.orgId,
      propertyId: input.propertyId,
      kind: input.kind,
      policyRefEnc: enc(input.policyRef),
      coverageCents: input.coverageCents,
      premiumCents: input.premiumCents ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      status: input.status ?? "quoted",
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy,
    })
    .returning();
  if (row.status === "bound" || row.status === "active") {
    await addEvent(tx, { propertyId: input.propertyId, kind: "policy_bound", title: `${input.orgName ?? "An insurer"} bound a ${row.kind.replace("_", " ")} policy`, actorId: input.createdBy, actorOrgId: input.orgId });
  }
  return row;
}
export async function updatePolicy(tx: Tx, id: string, patch: Partial<Pick<Policy, "status" | "notes" | "coverageCents" | "premiumCents" | "effectiveTo">> & { policyRef?: string | null }): Promise<Policy> {
  const { policyRef, ...rest } = patch;
  const set: Partial<Policy> = { ...rest };
  if (policyRef !== undefined) set.policyRefEnc = enc(policyRef);
  const [row] = await tx.update(policies).set(set).where(eq(policies.id, id)).returning();
  if (!row) throw new Error("Policy not found");
  return row;
}

/** Underwriting view: how the house does on each ledger category. */
export type CategoryBreakdown = { category: string; pass: number; attention: number; fail: number; notAssessable: number };
export async function categoryBreakdown(tx: Tx, propertyId: string): Promise<CategoryBreakdown[]> {
  const rows = await tx
    .select({ category: checkpointResults.category, status: checkpointResults.status, n: sql<number>`count(*)` })
    .from(checkpointResults)
    .where(eq(checkpointResults.propertyId, propertyId))
    .groupBy(checkpointResults.category, checkpointResults.status);
  const order = ["structure", "envelope", "moisture", "mechanical", "surfaces", "safety", "capture"];
  const out = new Map<string, CategoryBreakdown>(order.map((c) => [c, { category: c, pass: 0, attention: 0, fail: 0, notAssessable: 0 }]));
  for (const r of rows) {
    const b = out.get(r.category)!;
    if (r.status === "pass") b.pass += Number(r.n);
    else if (r.status === "attention") b.attention += Number(r.n);
    else if (r.status === "fail") b.fail += Number(r.n);
    else b.notAssessable += Number(r.n);
  }
  return [...out.values()];
}

/* ------------------------------- listings ------------------------------- */

export async function listListings(tx: Tx, orgId: string): Promise<WithProperty<Listing>[]> {
  return tx
    .select({ row: listings, property: properties, stats: propertyStats })
    .from(listings)
    .innerJoin(properties, eq(properties.id, listings.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(eq(listings.orgId, orgId))
    .orderBy(desc(listings.createdAt));
}
export async function getListing(tx: Tx, id: string): Promise<Listing | null> {
  return (await tx.select().from(listings).where(eq(listings.id, id)).limit(1))[0] ?? null;
}
export async function createListing(
  tx: Tx,
  input: { orgId: string; propertyId: string; agentIdentityId?: string | null; listPriceCents?: number | null; status?: Listing["status"]; mlsRef?: string | null; listedAt?: string | null; notes?: string | null; orgName?: string; actorId: string },
): Promise<Listing> {
  const [row] = await tx
    .insert(listings)
    .values({
      id: newId(),
      orgId: input.orgId,
      propertyId: input.propertyId,
      agentIdentityId: input.agentIdentityId ?? null,
      listPriceCents: input.listPriceCents ?? null,
      status: input.status ?? "draft",
      mlsRef: input.mlsRef?.trim() || null,
      listedAt: input.listedAt ?? null,
      notes: input.notes?.trim() || null,
    })
    .returning();
  await addEvent(tx, { propertyId: input.propertyId, kind: "listing_changed", title: `${input.orgName ?? "A brokerage"} created a listing`, actorId: input.actorId, actorOrgId: input.orgId });
  return row;
}
export async function updateListing(tx: Tx, id: string, patch: Partial<Pick<Listing, "status" | "listPriceCents" | "mlsRef" | "notes" | "shareLinkId" | "listedAt" | "closedAt" | "soldPriceCents" | "agentIdentityId">>, actorId?: string): Promise<Listing> {
  const [row] = await tx.update(listings).set(patch).where(eq(listings.id, id)).returning();
  if (!row) throw new Error("Listing not found");
  if (patch.status) await addEvent(tx, { propertyId: row.propertyId, kind: "listing_changed", title: `Listing marked ${patch.status}`, actorId: actorId ?? null, actorOrgId: row.orgId });
  return row;
}

/** Other graded houses in the same city, for a buyer-facing comparison. Only what the actor can see. */
export async function comparables(tx: Tx, property: Property, limit = 8): Promise<WithProperty<null>[]> {
  const rows = await tx
    .select({ property: properties, stats: propertyStats })
    .from(properties)
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(and(eq(properties.state, property.state), sql`upper(${properties.city}) = upper(${property.city})`, sql`${properties.id} <> ${property.id}`, sql`${propertyStats.stagesFilmed} > 0`))
    .orderBy(desc(propertyStats.meanScore))
    .limit(limit);
  return rows.map((r) => ({ row: null, property: r.property, stats: r.stats }));
}

/* -------------------------------- permits ------------------------------- */

export async function listPermits(tx: Tx, orgId: string): Promise<WithProperty<Permit>[]> {
  return tx
    .select({ row: permits, property: properties, stats: propertyStats })
    .from(permits)
    .innerJoin(properties, eq(properties.id, permits.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(eq(permits.municipalityOrgId, orgId))
    .orderBy(desc(permits.createdAt));
}
export async function listPermitsForProperty(tx: Tx, propertyId: string): Promise<Permit[]> {
  return tx.select().from(permits).where(eq(permits.propertyId, propertyId)).orderBy(desc(permits.createdAt));
}
export async function createPermit(
  tx: Tx,
  input: { propertyId: string; municipalityOrgId: string; recordId?: string | null; permitNo: string; kind: Permit["kind"]; status?: Permit["status"]; appliedAt?: string | null; issuedAt?: string | null; notes?: string | null; createdBy: string; orgName?: string },
): Promise<Permit> {
  const permitNo = input.permitNo.trim();
  if (!permitNo) throw new Error("Permit number is required");
  const [row] = await tx
    .insert(permits)
    .values({
      id: newId(),
      propertyId: input.propertyId,
      municipalityOrgId: input.municipalityOrgId,
      recordId: input.recordId ?? null,
      permitNo,
      kind: input.kind,
      status: input.status ?? "applied",
      appliedAt: input.appliedAt ?? null,
      issuedAt: input.issuedAt ?? null,
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy,
    })
    .returning();
  if (row.status === "issued") {
    await addEvent(tx, { propertyId: input.propertyId, kind: "permit_issued", title: `${input.orgName ?? "The municipality"} issued ${row.kind} permit ${permitNo}`, actorId: input.createdBy, actorOrgId: input.municipalityOrgId, visibility: "summary" });
  }
  return row;
}
export async function updatePermit(tx: Tx, id: string, patch: Partial<Pick<Permit, "status" | "notes" | "issuedAt" | "closedAt" | "recordId">>, actor?: { id: string; orgName?: string }): Promise<Permit> {
  const [row] = await tx.update(permits).set(patch).where(eq(permits.id, id)).returning();
  if (!row) throw new Error("Permit not found");
  if (patch.status === "issued") {
    await addEvent(tx, { propertyId: row.propertyId, kind: "permit_issued", title: `${actor?.orgName ?? "The municipality"} issued ${row.kind} permit ${row.permitNo}`, actorId: actor?.id ?? null, actorOrgId: row.municipalityOrgId, visibility: "summary" });
  }
  return row;
}

/* --------------------------- municipality view -------------------------- */

/** Every property inside the municipality's jurisdictions. RLS already allows ledger scope; this is the explicit query. */
export async function listJurisdictionProperties(tx: Tx, orgId: string): Promise<{ property: Property; stats: PropertyStats }[]> {
  const rows = await tx
    .selectDistinctOn([properties.id], { property: properties, stats: propertyStats })
    .from(properties)
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .innerJoin(
      jurisdictions,
      and(
        eq(jurisdictions.orgId, orgId),
        eq(jurisdictions.state, properties.state),
        or(
          sql`${jurisdictions.city} IS NOT NULL AND upper(${jurisdictions.city}) = upper(${properties.city})`,
          sql`${jurisdictions.county} IS NOT NULL AND ${properties.county} IS NOT NULL AND upper(${jurisdictions.county}) = upper(${properties.county})`,
          sql`${jurisdictions.postalCode} IS NOT NULL AND ${jurisdictions.postalCode} = ${properties.postalCode}`,
        ),
      ),
    )
    .orderBy(properties.id);
  return rows.sort((a, b) => (b.stats.lastCaptureAt?.getTime() ?? 0) - (a.stats.lastCaptureAt?.getTime() ?? 0));
}

export type InspectionQueueRow = { capture: Capture; grade: StageGrade | null; property: Property; review: InspectionReview | null };

/** Filmed stages inside the jurisdiction that this municipality has not yet reviewed, newest first. */
export async function listInspectionQueue(tx: Tx, orgId: string, opts: { includeReviewed?: boolean } = {}): Promise<InspectionQueueRow[]> {
  const inJurisdiction = (await listJurisdictionProperties(tx, orgId)).map((r) => r.property.id);
  if (!inJurisdiction.length) return [];
  const reviewed = await tx.select().from(inspectionReviews).where(eq(inspectionReviews.municipalityOrgId, orgId));
  const reviewedBy = new Map(reviewed.map((r) => [r.captureId, r]));
  const conds = [inArray(captures.propertyId, inJurisdiction), eq(captures.state, "done")];
  if (!opts.includeReviewed && reviewedBy.size) conds.push(notInArray(captures.id, [...reviewedBy.keys()]));
  const rows = await tx
    .select({ capture: captures, grade: stageGrades, property: properties })
    .from(captures)
    .leftJoin(stageGrades, eq(stageGrades.captureId, captures.id))
    .innerJoin(properties, eq(properties.id, captures.propertyId))
    .where(and(...conds))
    .orderBy(desc(captures.updatedAt));
  return rows.map((r) => ({ ...r, review: reviewedBy.get(r.capture.id) ?? null }));
}

export async function recordInspectionReview(
  tx: Tx,
  input: { captureId: string; propertyId: string; municipalityOrgId: string; permitId?: string | null; reviewerId: string; verdict: InspectionReview["verdict"]; notes?: string | null; orgName?: string; stage?: StageId },
): Promise<InspectionReview> {
  await tx.delete(inspectionReviews).where(and(eq(inspectionReviews.captureId, input.captureId), eq(inspectionReviews.municipalityOrgId, input.municipalityOrgId)));
  const [row] = await tx
    .insert(inspectionReviews)
    .values({ id: newId(), captureId: input.captureId, propertyId: input.propertyId, municipalityOrgId: input.municipalityOrgId, permitId: input.permitId ?? null, reviewerId: input.reviewerId, verdict: input.verdict, notes: input.notes?.trim() || null })
    .returning();
  const word = input.verdict === "verified" ? "verified" : input.verdict === "flagged" ? "flagged" : "scheduled for a site visit";
  await addEvent(tx, {
    propertyId: input.propertyId,
    kind: "inspection_verdict",
    title: `${input.stage ? stageDef(input.stage).label : "Stage"} ${word}${input.orgName ? ` by ${input.orgName}` : ""}`,
    detail: input.notes ?? null,
    stage: input.stage ?? null,
    actorId: input.reviewerId,
    actorOrgId: input.municipalityOrgId,
    visibility: "summary",
  });
  return row;
}
export async function listReviewsForProperty(tx: Tx, propertyId: string): Promise<InspectionReview[]> {
  return tx.select().from(inspectionReviews).where(eq(inspectionReviews.propertyId, propertyId)).orderBy(desc(inspectionReviews.at));
}

/* ------------------------------ dashboards ------------------------------ */

export type GradeHistogram = Record<"A" | "B" | "C" | "D" | "F", number>;
export function gradeHistogram(stats: PropertyStats[]): GradeHistogram {
  const h: GradeHistogram = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const s of stats) if (s.meanScore != null) h[toGrade(s.meanScore)]++;
  return h;
}

/** Stage completion across a set of properties: how many have each stage on file. */
export async function stageCompletion(tx: Tx, propertyIds: string[]): Promise<{ stage: StageId; label: string; short: string; filmed: number; meanScore: number | null }[]> {
  if (!propertyIds.length) return [];
  const rows = await tx
    .select({ stage: stageGrades.stage, n: sql<number>`count(*)`, mean: sql<number>`avg(${stageGrades.score})` })
    .from(stageGrades)
    .where(inArray(stageGrades.propertyId, propertyIds))
    .groupBy(stageGrades.stage);
  const by = new Map(rows.map((r) => [r.stage, r]));
  const { STAGES } = await import("@homefax/core");
  return STAGES.map((s) => ({ stage: s.id, label: s.label, short: s.short, filmed: Number(by.get(s.id)?.n ?? 0), meanScore: by.get(s.id)?.mean != null ? Number(by.get(s.id)!.mean) : null }));
}

/** Properties a member of this org can reach, by any path. For the institution's search and "add" flows. */
export async function listReachableProperties(tx: Tx, _orgId: string): Promise<{ property: Property; stats: PropertyStats }[]> {
  // RLS does the work: this returns exactly what the actor may see.
  return tx
    .select({ property: properties, stats: propertyStats })
    .from(properties)
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .orderBy(desc(propertyStats.lastCaptureAt), properties.line1)
    .limit(500);
}

export async function isMunicipalityMember(tx: Tx, orgId: string, identityId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(organizations, and(eq(organizations.id, memberships.orgId), eq(organizations.kind, "municipality")))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.identityId, identityId)))
    .limit(1);
  return rows.length > 0;
}
