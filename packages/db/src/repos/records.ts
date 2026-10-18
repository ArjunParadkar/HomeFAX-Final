import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { PartLine, QualityReport, ReconJob, StageId } from "@homefax/core";
import { STAGES, stageDef } from "@homefax/core";
import type { Tx } from "../client";
import { newId, slugify } from "../ids";
import { identities } from "../schema/auth";
import {
  assignments,
  captures,
  checkpointResults,
  findings,
  hires,
  partLines,
  recordAccess,
  records,
  stageGrades,
  type Assignment,
  type BuildRecord,
  type Capture,
  type CheckpointResultRow,
  type FindingRow,
  type Hire,
  type PartLineRow,
  type RecordAccess,
  type StageGrade,
} from "../schema/build";
import { organizations, type Organization } from "../schema/org";
import { profiles } from "../schema/people";
import { properties, propertyStats, type Property, type PropertyStats } from "../schema/property";
import { getOrgByHfxKey } from "./orgs";
import { addEvent } from "./properties";

export const IN_FLIGHT_STATES = new Set(["queued", "extracting", "registering", "reconstructing", "meshing", "analyzing"]);

export type RecordWithProperty = { record: BuildRecord; property: Property; stats: PropertyStats };

async function uniqueRecordSlug(tx: Tx, property: Property): Promise<string> {
  const base = slugify(`${property.line1}${property.line2 ? ` ${property.line2}` : ""}`, 60);
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const clash = await tx.select({ id: records.id }).from(records).where(eq(records.slug, slug)).limit(1);
    if (!clash.length) return slug;
    slug = `${base.slice(0, 55)}-${newId().slice(0, 4).toLowerCase()}`;
  }
  throw new Error("Could not find a free slug");
}

/**
 * Open a build record on a property for a contractor org. The org becomes the
 * record's owner on the project team. Run as the ACTOR (a member of orgId).
 */
export async function createRecord(
  tx: Tx,
  input: { property: Property; orgId: string; orgName: string; ownerName?: string | null; title?: string | null; createdBy: string; legacyKeyId?: string | null; id?: string; slug?: string },
): Promise<BuildRecord> {
  const [record] = await tx
    .insert(records)
    .values({
      id: input.id ?? newId(),
      slug: input.slug ?? (await uniqueRecordSlug(tx, input.property)),
      propertyId: input.property.id,
      orgId: input.orgId,
      title: input.title?.trim() || null,
      ownerName: input.ownerName?.trim() || null,
      contractorName: input.orgName,
      legacyKeyId: input.legacyKeyId ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  await tx.insert(recordAccess).values({ id: newId(), recordId: record.id, orgId: input.orgId, role: "owner", addedBy: input.createdBy });
  await addEvent(tx, {
    propertyId: input.property.id,
    kind: "record_opened",
    title: `${input.orgName} opened the build record`,
    actorId: input.createdBy,
    actorOrgId: input.orgId,
    visibility: "summary",
  });
  return record;
}

export async function getRecord(tx: Tx, id: string): Promise<BuildRecord | null> {
  return (await tx.select().from(records).where(eq(records.id, id)).limit(1))[0] ?? null;
}
export async function getRecordBySlug(tx: Tx, slug: string): Promise<RecordWithProperty | null> {
  const rows = await tx
    .select({ record: records, property: properties, stats: propertyStats })
    .from(records)
    .innerJoin(properties, eq(properties.id, records.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(eq(records.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateRecord(tx: Tx, id: string, patch: Partial<Pick<BuildRecord, "title" | "ownerName" | "status" | "completedAt">>): Promise<BuildRecord> {
  const [row] = await tx.update(records).set(patch).where(eq(records.id, id)).returning();
  if (!row) throw new Error("Record not found or not yours to edit");
  return row;
}

/** Records an org owns or collaborates on, newest first. */
export async function listRecordsForOrg(tx: Tx, orgId: string): Promise<RecordWithProperty[]> {
  return tx
    .select({ record: records, property: properties, stats: propertyStats })
    .from(recordAccess)
    .innerJoin(records, eq(records.id, recordAccess.recordId))
    .innerJoin(properties, eq(properties.id, records.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(eq(recordAccess.orgId, orgId))
    .orderBy(desc(records.createdAt));
}

export async function listRecordsForProperty(tx: Tx, propertyId: string): Promise<BuildRecord[]> {
  return tx.select().from(records).where(eq(records.propertyId, propertyId)).orderBy(desc(records.createdAt));
}

/* ----------------------------- project team ----------------------------- */

export type ProjectOrg = { access: RecordAccess; org: Organization };

export async function listProjectOrgs(tx: Tx, recordId: string): Promise<ProjectOrg[]> {
  const rows = await tx
    .select({ access: recordAccess, org: organizations })
    .from(recordAccess)
    .innerJoin(organizations, eq(organizations.id, recordAccess.orgId))
    .where(eq(recordAccess.recordId, recordId))
    .orderBy(recordAccess.createdAt);
  return rows;
}

/** Service lookup of the key, actor insert of the access row. Pass both transactions' worth of context via the same service tx when convenient. */
export async function addOrgToRecordByKey(tx: Tx, input: { recordId: string; hfxKey: string; addedBy: string }): Promise<Organization> {
  const org = await getOrgByHfxKey(tx, input.hfxKey);
  if (!org) throw new Error("No company has that HomeFAX key");
  const existing = (await tx.select().from(recordAccess).where(and(eq(recordAccess.recordId, input.recordId), eq(recordAccess.orgId, org.id))).limit(1))[0];
  if (!existing) {
    await tx.insert(recordAccess).values({ id: newId(), recordId: input.recordId, orgId: org.id, role: "collaborator", addedBy: input.addedBy });
  }
  return org;
}

export async function grantRecordAccess(tx: Tx, input: { recordId: string; orgId: string; role?: "owner" | "collaborator"; addedBy?: string | null }): Promise<void> {
  const existing = (await tx.select().from(recordAccess).where(and(eq(recordAccess.recordId, input.recordId), eq(recordAccess.orgId, input.orgId))).limit(1))[0];
  if (existing) return;
  await tx.insert(recordAccess).values({ id: newId(), recordId: input.recordId, orgId: input.orgId, role: input.role ?? "collaborator", addedBy: input.addedBy ?? null });
}

export async function removeOrgFromRecord(tx: Tx, recordId: string, orgId: string): Promise<void> {
  await tx.delete(recordAccess).where(and(eq(recordAccess.recordId, recordId), eq(recordAccess.orgId, orgId), eq(recordAccess.role, "collaborator")));
}

/* -------------------------------- captures ------------------------------ */

export async function listCaptures(tx: Tx, recordId: string): Promise<Capture[]> {
  return tx.select().from(captures).where(eq(captures.recordId, recordId)).orderBy(captures.createdAt);
}
export async function listCapturesForProperty(tx: Tx, propertyId: string): Promise<Capture[]> {
  return tx.select().from(captures).where(eq(captures.propertyId, propertyId)).orderBy(captures.createdAt);
}
export async function getCapture(tx: Tx, id: string): Promise<Capture | null> {
  return (await tx.select().from(captures).where(eq(captures.id, id)).limit(1))[0] ?? null;
}

/** One capture per stage: a re-film replaces the earlier attempt and its derived rows. */
export async function upsertCapture(
  tx: Tx,
  input: { id?: string; record: BuildRecord; stage: StageId; jobId: string | null; state?: string; sourceUrl?: string | null; frames: string[]; filmedBy?: string | null; filmedByOrgId?: string | null },
): Promise<Capture> {
  await tx.delete(captures).where(and(eq(captures.recordId, input.record.id), eq(captures.stage, input.stage)));
  const [row] = await tx
    .insert(captures)
    .values({
      id: input.id ?? newId(),
      recordId: input.record.id,
      propertyId: input.record.propertyId,
      stage: input.stage,
      jobId: input.jobId,
      state: input.state ?? "queued",
      sourceUrl: input.sourceUrl ?? null,
      frames: input.frames,
      filmedBy: input.filmedBy ?? null,
      filmedByOrgId: input.filmedByOrgId ?? null,
    })
    .returning();
  await addEvent(tx, {
    propertyId: input.record.propertyId,
    kind: "stage_filmed",
    title: `${stageDef(input.stage).label} filmed`,
    stage: input.stage,
    actorId: input.filmedBy ?? null,
    actorOrgId: input.filmedByOrgId ?? null,
    visibility: "summary",
  });
  return row;
}

export async function updateCapture(tx: Tx, id: string, patch: Partial<Pick<Capture, "state" | "glbUrl" | "job" | "quality" | "parts" | "score" | "notes">>): Promise<void> {
  await tx.update(captures).set(patch).where(eq(captures.id, id));
}

export async function failCapture(tx: Tx, id: string, job: ReconJob): Promise<void> {
  const cap = await getCapture(tx, id);
  if (!cap) return;
  await tx.update(captures).set({ state: "failed", job }).where(eq(captures.id, id));
  await addEvent(tx, { propertyId: cap.propertyId, kind: "stage_failed", title: `${stageDef(cap.stage).label} reconstruction failed`, detail: job.error ?? null, stage: cap.stage, visibility: "summary" });
}

/**
 * The reconstruction landed and the grading ran. Store the raw report on the
 * capture and flatten it into the queryable tables. Stats recompute by trigger.
 */
export async function finalizeCapture(
  tx: Tx,
  id: string,
  result: { job: ReconJob; glbUrl: string | null; quality: QualityReport; parts: PartLine[]; notes?: string | null },
): Promise<Capture> {
  const cap = await getCapture(tx, id);
  if (!cap) throw new Error("Capture not found");
  const simulated = result.glbUrl?.startsWith("procedural://") ?? false;
  const [updated] = await tx
    .update(captures)
    .set({ state: "done", job: result.job, glbUrl: result.glbUrl, quality: result.quality, parts: result.parts, score: result.quality.score, notes: result.notes ?? null })
    .where(eq(captures.id, id))
    .returning();

  await tx.delete(checkpointResults).where(eq(checkpointResults.captureId, id));
  await tx.delete(findings).where(eq(findings.captureId, id));
  await tx.delete(partLines).where(eq(partLines.captureId, id));
  await tx.delete(stageGrades).where(eq(stageGrades.captureId, id));

  const q = result.quality;
  const dim = (d: string) => q.dimensions.find((x) => x.dimension === d)?.score ?? null;
  const cps = q.checkpoints ?? [];
  if (cps.length) {
    await tx.insert(checkpointResults).values(
      cps.map((c) => ({
        id: newId(),
        captureId: id,
        propertyId: cap.propertyId,
        stage: cap.stage,
        qcId: c.id,
        num: c.num,
        title: c.title,
        category: c.category,
        status: c.status,
        source: c.source,
        evidence: c.evidence,
        keyframeIndex: c.keyframeIndex ?? null,
      })),
    );
  }
  if (q.findings.length) {
    await tx.insert(findings).values(
      q.findings.map((f) => ({
        id: newId(),
        captureId: id,
        propertyId: cap.propertyId,
        stage: cap.stage,
        severity: f.severity,
        dimension: f.dimension,
        source: f.source,
        title: f.title,
        detail: f.detail,
        keyframeIndex: f.keyframeIndex ?? null,
      })),
    );
  }
  if (result.parts.length) {
    await tx.insert(partLines).values(
      result.parts.map((p) => ({
        id: newId(),
        captureId: id,
        propertyId: cap.propertyId,
        stage: cap.stage,
        sku: p.sku,
        name: p.name,
        category: p.category,
        spec: p.spec ?? null,
        quantity: p.quantity,
        unit: p.unit,
        basis: p.basis,
        derivation: p.derivation,
        confidence: p.confidence,
        unitCostCents: p.unitCostUsd != null ? Math.round(p.unitCostUsd * 100) : null,
        identified: p.identified ?? null,
      })),
    );
  }
  // The grade goes in last: its trigger recomputes the stats row, which must
  // already see the ledger, findings and materials written above.
  await tx.insert(stageGrades).values({
    id: newId(),
    captureId: id,
    recordId: cap.recordId,
    propertyId: cap.propertyId,
    stage: cap.stage,
    score: q.score,
    grade: q.grade,
    captureScore: dim("capture"),
    geometryScore: dim("geometry"),
    workmanshipScore: dim("workmanship"),
    complianceScore: dim("compliance"),
    visionStatus: q.visionStatus ?? (q.visionAvailable ? "graded" : "unavailable"),
    checkpointsPassed: q.checkpointsPassed ?? cps.filter((c) => c.status === "pass").length,
    checkpointsAssessed: q.checkpointsAssessed ?? cps.filter((c) => c.status !== "not_assessable").length,
    checkpointsApplicable: q.checkpointsApplicable ?? cps.length,
    simulated,
    filmedAt: cap.createdAt,
  });
  await tx.execute(sql`SELECT property.recompute_stats(${cap.propertyId})`);

  await addEvent(tx, {
    propertyId: cap.propertyId,
    kind: "stage_graded",
    title: `${stageDef(cap.stage).label} graded ${q.grade} (${Math.round(q.score)}/100)`,
    detail: result.notes ?? null,
    stage: cap.stage,
    actorOrgId: cap.filmedByOrgId,
    visibility: "summary",
  });
  return updated;
}

/* --------------------------- flattened reads ---------------------------- */

export async function listStageGrades(tx: Tx, propertyId: string): Promise<StageGrade[]> {
  return tx.select().from(stageGrades).where(eq(stageGrades.propertyId, propertyId)).orderBy(stageGrades.filmedAt);
}
export async function listCheckpointResults(tx: Tx, propertyId: string, filter?: { status?: CheckpointResultRow["status"][]; category?: CheckpointResultRow["category"][] }): Promise<CheckpointResultRow[]> {
  const conds = [eq(checkpointResults.propertyId, propertyId)];
  if (filter?.status?.length) conds.push(inArray(checkpointResults.status, filter.status));
  if (filter?.category?.length) conds.push(inArray(checkpointResults.category, filter.category));
  return tx.select().from(checkpointResults).where(and(...conds)).orderBy(checkpointResults.num);
}
export async function listFindings(tx: Tx, propertyId: string, openOnly = true): Promise<FindingRow[]> {
  return tx
    .select()
    .from(findings)
    .where(openOnly ? and(eq(findings.propertyId, propertyId), isNull(findings.resolvedAt)) : eq(findings.propertyId, propertyId))
    .orderBy(sql`CASE ${findings.severity} WHEN 'critical' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END`);
}
export async function resolveFinding(tx: Tx, id: string, by: string): Promise<void> {
  await tx.update(findings).set({ resolvedAt: new Date(), resolvedBy: by }).where(eq(findings.id, id));
}
export async function listPartLines(tx: Tx, propertyId: string): Promise<PartLineRow[]> {
  return tx.select().from(partLines).where(eq(partLines.propertyId, propertyId)).orderBy(partLines.category, partLines.name);
}

/** Stage-by-stage status for a property: the comb everyone draws. */
export type StageStatus = { stage: StageId; label: string; short: string; state: "done" | "working" | "failed" | "open"; grade: StageGrade["grade"] | null; score: number | null; captureId: string | null };
export async function stageStatuses(tx: Tx, propertyId: string): Promise<StageStatus[]> {
  const caps = await listCapturesForProperty(tx, propertyId);
  const byStage = new Map(caps.map((c) => [c.stage, c]));
  return STAGES.map((s) => {
    const c = byStage.get(s.id);
    const state = !c ? "open" : c.state === "done" ? "done" : c.state === "failed" ? "failed" : IN_FLIGHT_STATES.has(c.state) ? "working" : "open";
    return { stage: s.id, label: s.label, short: s.short, state, grade: c?.quality?.grade ?? null, score: c?.score ?? null, captureId: c?.id ?? null };
  });
}

/* ------------------------------ assignments ----------------------------- */

export async function createAssignment(
  tx: Tx,
  input: { recordId: string; assigneeIdentityId?: string | null; assigneeOrgId?: string | null; task: string; stage?: StageId | null; assignedBy: string },
): Promise<Assignment> {
  const task = input.task.trim();
  if (!task) throw new Error("Describe the work");
  if (!input.assigneeIdentityId === !input.assigneeOrgId) throw new Error("Assign to exactly one person or company");
  const [row] = await tx
    .insert(assignments)
    .values({ id: newId(), recordId: input.recordId, assigneeIdentityId: input.assigneeIdentityId ?? null, assigneeOrgId: input.assigneeOrgId ?? null, task, stage: input.stage ?? null, assignedBy: input.assignedBy })
    .returning();
  return row;
}
export async function setAssignmentStatus(tx: Tx, id: string, status: Assignment["status"]): Promise<void> {
  await tx.update(assignments).set({ status }).where(eq(assignments.id, id));
}
export async function getAssignment(tx: Tx, id: string): Promise<Assignment | null> {
  return (await tx.select().from(assignments).where(eq(assignments.id, id)).limit(1))[0] ?? null;
}
export async function listAssignmentsForRecord(tx: Tx, recordId: string): Promise<Assignment[]> {
  return tx.select().from(assignments).where(eq(assignments.recordId, recordId)).orderBy(desc(assignments.createdAt));
}
/** Everything assigned to a person directly or to any org they belong to. */
export async function listAssignmentsForIdentity(tx: Tx, identityId: string, orgIds: string[]): Promise<Assignment[]> {
  const cond = orgIds.length
    ? or(eq(assignments.assigneeIdentityId, identityId), inArray(assignments.assigneeOrgId, orgIds))
    : eq(assignments.assigneeIdentityId, identityId);
  return tx.select().from(assignments).where(cond).orderBy(desc(assignments.createdAt));
}

/* --------------------------------- hires -------------------------------- */

export async function createHire(
  tx: Tx,
  input: { fromOrgId: string; toIdentityId?: string | null; toOrgId?: string | null; task: string; recordId?: string | null; note?: string | null; createdBy: string },
): Promise<Hire> {
  const task = input.task.trim();
  if (!task) throw new Error("Describe the work");
  if (!input.toIdentityId === !input.toOrgId) throw new Error("Offer to exactly one person or company");
  const [row] = await tx
    .insert(hires)
    .values({ id: newId(), fromOrgId: input.fromOrgId, toIdentityId: input.toIdentityId ?? null, toOrgId: input.toOrgId ?? null, task, recordId: input.recordId ?? null, note: input.note?.trim() || null, createdBy: input.createdBy })
    .returning();
  return row;
}
export async function getHire(tx: Tx, id: string): Promise<Hire | null> {
  return (await tx.select().from(hires).where(eq(hires.id, id)).limit(1))[0] ?? null;
}
export async function setHireStatus(tx: Tx, id: string, status: Hire["status"]): Promise<void> {
  await tx.update(hires).set({ status }).where(eq(hires.id, id));
}
export async function listHiresFromOrg(tx: Tx, orgId: string): Promise<Hire[]> {
  return tx.select().from(hires).where(eq(hires.fromOrgId, orgId)).orderBy(desc(hires.createdAt));
}
export async function listIncomingHires(tx: Tx, identityId: string, orgIds: string[]): Promise<Hire[]> {
  const cond = orgIds.length ? or(eq(hires.toIdentityId, identityId), inArray(hires.toOrgId, orgIds)) : eq(hires.toIdentityId, identityId);
  return tx.select().from(hires).where(cond).orderBy(desc(hires.createdAt));
}

/** Who a user is, for display: the names behind ids on a record page. */
export async function namesFor(tx: Tx, identityIds: string[]): Promise<Map<string, string>> {
  if (!identityIds.length) return new Map();
  const rows = await tx.select({ id: profiles.identityId, name: profiles.name }).from(profiles).where(inArray(profiles.identityId, [...new Set(identityIds)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function emailsFor(tx: Tx, identityIds: string[]): Promise<Map<string, string>> {
  if (!identityIds.length) return new Map();
  const rows = await tx.select({ id: identities.id, email: identities.email }).from(identities).where(inArray(identities.id, [...new Set(identityIds)]));
  return new Map(rows.map((r) => [r.id, r.email]));
}
