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
  keyId: string;
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

const FILE = path.join(process.cwd(), ".data", "store.json");

type FileShape = { records: RecordRow[]; captures: CaptureRow[] };

async function readFile(): Promise<FileShape> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    return { records: parsed.records ?? [], captures: parsed.captures ?? [] };
  } catch {
    return { records: [], captures: [] };
  }
}

async function writeFile(data: FileShape): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  // Write-then-rename so a crash mid-write cannot truncate the store.
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, FILE);
}

/* ------------------------------ public API ------------------------------ */

export async function listRecords(keyId: string): Promise<RecordRow[]> {
  if (storeBackend === "file") {
    const d = await readFile();
    return d.records
      .filter((r) => r.keyId === keyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const db = getDb();
  const rows = await db.select().from(schema.records).where(eq(schema.records.keyId, keyId));
  return rows
    .map(toRecordRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createRecord(input: {
  id: string;
  slug: string;
  address: string;
  owner?: string;
  contractor?: string;
  keyId: string;
}): Promise<RecordRow> {
  const row: RecordRow = {
    id: input.id,
    slug: input.slug,
    address: input.address,
    owner: input.owner ?? null,
    contractor: input.contractor ?? null,
    keyId: input.keyId,
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
  });
  return row;
}

export async function getRecord(slug: string, keyId: string): Promise<RecordRow | null> {
  if (storeBackend === "file") {
    const d = await readFile();
    return d.records.find((r) => r.slug === slug && r.keyId === keyId) ?? null;
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.records)
    .where(and(eq(schema.records.slug, slug), eq(schema.records.keyId, keyId)))
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
