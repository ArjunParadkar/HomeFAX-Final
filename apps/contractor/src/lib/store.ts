import { and, eq } from "drizzle-orm";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dbConfigured, getDb, schema } from "./db";
import type {
  PartLine,
  QualityReport,
  ReconJob,
  StageId,
} from "./types";

/**
 * Two backends behind one interface.
 *
 * Postgres is what runs in production. When DATABASE_URL is absent the store
 * falls back to a JSON file under .data/ so the app is fully usable on a
 * laptop with nothing provisioned — same behaviour, no setup.
 */

export type RecordRow = {
  id: string;
  slug: string;
  address: string;
  owner: string | null;
  contractor: string | null;
  /** Legacy key id — null for all records created after the accounts launch. */
  keyId: string | null;
  /** The company that owns this record — the tenant boundary. */
  orgId: string | null;
  createdAt: string;
};

export type CaptureRow = {
  id: string;
  recordId: string;
  stage: StageId;
  jobId: string | null;
  state: string;
  sourceUrl: string | null;
  /** The keyframes this capture was built from, in order. */
  frames: string[];
  glbUrl: string | null;
  job: ReconJob | null;
  quality: QualityReport | null;
  parts: PartLine[];
  score: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export const storeBackend = dbConfigured ? "postgres" : "file";

/* ----------------------------- file backend ----------------------------- */

/**
 * Resolved lazily so test runners can chdir() to a temp directory before the
 * first call and have reads/writes land there.
 */
export function getDataFile(): string {
  return path.join(process.cwd(), ".data", "store.json");
}

/** Minimal project-access shape needed for the record-list union. */
type ProjectAccessRef = { id: string; recordId: string; orgId: string; role: string };

type FileShape = {
  records: RecordRow[];
  captures: CaptureRow[];
  /** Preserved opaquely; owned and written by accounts.ts. */
  projectAccess?: ProjectAccessRef[];
  users?: unknown[];
  orgs?: unknown[];
  memberships?: unknown[];
  assignments?: unknown[];
  hires?: unknown[];
};

async function readFile(): Promise<FileShape> {
  const file = getDataFile();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    return {
      records: (parsed.records ?? []) as RecordRow[],
      captures: (parsed.captures ?? []) as CaptureRow[],
      projectAccess: parsed.projectAccess,
      users: parsed.users,
      orgs: parsed.orgs,
      memberships: parsed.memberships,
      assignments: parsed.assignments,
      hires: parsed.hires,
    };
  } catch {
    return { records: [], captures: [] };
  }
}

async function writeFile(data: FileShape): Promise<void> {
  const file = getDataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write cannot truncate the store.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

/* ------------------------------ public API ------------------------------ */

/**
 * All records accessible to an org: records it owns (orgId match) plus
 * records it has been granted project access to.
 */
export async function listRecordsForOrg(orgId: string): Promise<RecordRow[]> {
  if (storeBackend === "file") {
    const d = await readFile();
    const paIds = new Set(
      (d.projectAccess ?? []).filter((pa) => pa.orgId === orgId).map((pa) => pa.recordId),
    );
    return d.records
      .filter((r) => r.orgId === orgId || paIds.has(r.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const db = getDb();
  const owned = await db
    .select()
    .from(schema.records)
    .where(eq(schema.records.orgId, orgId));
  const via = await db
    .select({ record: schema.records })
    .from(schema.records)
    .innerJoin(
      schema.projectAccess,
      and(
        eq(schema.projectAccess.recordId, schema.records.id),
        eq(schema.projectAccess.orgId, orgId),
      ),
    );
  const seen = new Set<string>();
  const all: (typeof schema.records.$inferSelect)[] = [];
  for (const row of [...owned, ...via.map((v) => v.record)]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      all.push(row);
    }
  }
  return all.map(toRecordRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createRecord(input: {
  id: string;
  slug: string;
  address: string;
  owner?: string;
  contractor?: string;
  /** Legacy key — omit for new org-owned records. */
  keyId?: string;
  /** The owning org. */
  orgId?: string;
}): Promise<RecordRow> {
  const row: RecordRow = {
    id: input.id,
    slug: input.slug,
    address: input.address,
    owner: input.owner ?? null,
    contractor: input.contractor ?? null,
    keyId: input.keyId ?? null,
    orgId: input.orgId ?? null,
    createdAt: new Date().toISOString(),
  };
  if (storeBackend === "file") {
    const d = await readFile();
    d.records.push(row);
    await writeFile(d);
    return row;
  }
  const db = getDb();
  await db.insert(schema.records).values({
    id: row.id,
    slug: row.slug,
    address: row.address,
    owner: row.owner,
    contractor: row.contractor,
    keyId: row.keyId,
    orgId: row.orgId,
  });
  return row;
}

/** Look up a record by slug. Callers are responsible for access checks. */
export async function getRecordBySlug(slug: string): Promise<RecordRow | null> {
  if (storeBackend === "file") {
    const d = await readFile();
    return d.records.find((r) => r.slug === slug) ?? null;
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.records)
    .where(eq(schema.records.slug, slug))
    .limit(1);
  return rows[0] ? toRecordRow(rows[0]) : null;
}

/** Look up a record by id. Callers are responsible for access checks. */
export async function getRecordById(id: string): Promise<RecordRow | null> {
  if (storeBackend === "file") {
    const d = await readFile();
    return d.records.find((r) => r.id === id) ?? null;
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.records)
    .where(eq(schema.records.id, id))
    .limit(1);
  return rows[0] ? toRecordRow(rows[0]) : null;
}

export async function listCaptures(recordId: string): Promise<CaptureRow[]> {
  if (storeBackend === "file") {
    const d = await readFile();
    return d.captures.filter((c) => c.recordId === recordId);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.captures)
    .where(eq(schema.captures.recordId, recordId));
  return rows.map(toCaptureRow);
}

export async function getCapture(id: string): Promise<CaptureRow | null> {
  if (storeBackend === "file") {
    const d = await readFile();
    return d.captures.find((c) => c.id === id) ?? null;
  }
  const db = getDb();
  const rows = await db.select().from(schema.captures).where(eq(schema.captures.id, id)).limit(1);
  return rows[0] ? toCaptureRow(rows[0]) : null;
}

/** One capture per stage: a re-film replaces the previous attempt outright. */
export async function upsertCapture(row: {
  id: string;
  recordId: string;
  stage: StageId;
  jobId: string | null;
  state: string;
  sourceUrl: string | null;
  frames: string[];
}): Promise<CaptureRow> {
  const now = new Date().toISOString();
  const full: CaptureRow = {
    ...row,
    glbUrl: null,
    job: null,
    quality: null,
    parts: [],
    score: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
  if (storeBackend === "file") {
    const d = await readFile();
    d.captures = d.captures.filter(
      (c) => !(c.recordId === row.recordId && c.stage === row.stage),
    );
    d.captures.push(full);
    await writeFile(d);
    return full;
  }
  const db = getDb();
  await db
    .delete(schema.captures)
    .where(
      and(eq(schema.captures.recordId, row.recordId), eq(schema.captures.stage, row.stage)),
    );
  await db.insert(schema.captures).values({
    id: row.id,
    recordId: row.recordId,
    stage: row.stage,
    jobId: row.jobId,
    state: row.state,
    sourceUrl: row.sourceUrl,
    frames: row.frames,
  });
  return full;
}

export async function updateCapture(
  id: string,
  patch: Partial<
    Pick<CaptureRow, "state" | "glbUrl" | "job" | "quality" | "parts" | "score" | "notes">
  >,
): Promise<void> {
  if (storeBackend === "file") {
    const d = await readFile();
    const idx = d.captures.findIndex((c) => c.id === id);
    if (idx < 0) return;
    d.captures[idx] = { ...d.captures[idx], ...patch, updatedAt: new Date().toISOString() };
    await writeFile(d);
    return;
  }
  const db = getDb();
  await db
    .update(schema.captures)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.captures.id, id));
}

/* ------------------------------- mapping -------------------------------- */

function toRecordRow(r: typeof schema.records.$inferSelect): RecordRow {
  return {
    id: r.id,
    slug: r.slug,
    address: r.address,
    owner: r.owner,
    contractor: r.contractor,
    keyId: r.keyId,
    orgId: r.orgId,
    createdAt: r.createdAt.toISOString(),
  };
}

function toCaptureRow(c: typeof schema.captures.$inferSelect): CaptureRow {
  return {
    id: c.id,
    recordId: c.recordId,
    stage: c.stage,
    jobId: c.jobId,
    state: c.state,
    sourceUrl: c.sourceUrl,
    frames: c.frames ?? [],
    glbUrl: c.glbUrl,
    job: c.job,
    quality: c.quality,
    parts: c.parts ?? [],
    score: c.score,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
