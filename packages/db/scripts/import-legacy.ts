/**
 * Bring the pre-platform contractor data (the `homefax` schema, or a
 * .data/store.json file) into the platform schemas. Idempotent: rows that
 * already exist (same ids) are skipped, so it can be re-run right before
 * cutover to pick up anything that changed in between.
 *
 *   DATABASE_URL=… npx tsx scripts/import-legacy.ts \
 *     [--file apps/contractor/.data/store.json] \
 *     [--default-city Bentonville --default-state AR --default-zip 72712]
 *
 * Legacy records carry a free-text address ("1418 Ridgemont Dr"). When it
 * cannot be parsed into street / city / state / ZIP, the defaults fill the
 * gaps and the record's title says so, so someone can correct it later.
 */
import { readFileSync } from "node:fs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { loadEnv } from "../src/env";
import { parseAddressLine, type AddressParts } from "../src/address";
import { newId } from "../src/ids";

loadEnv();
if (!process.env.PII_ENCRYPTION_KEY) process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 42).toString("base64");

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const file = arg("--file");
const defaults = { city: arg("--default-city") ?? "Bentonville", state: arg("--default-state") ?? "AR", zip: arg("--default-zip") ?? "72712" };

type L = {
  users: { id: string; email: string; passwordHash: string; name: string; handle: string; headline: string | null; bio: string | null; isPublic: boolean; createdAt: string }[];
  orgs: { id: string; name: string; slug: string; headline: string | null; bio: string | null; isPublic: boolean; hfxKey: string; ownerUserId: string; claimedKeyId: string | null; createdAt: string }[];
  memberships: { id: string; orgId: string; userId: string; role: "owner" | "admin" | "member"; title: string | null; createdAt: string }[];
  records: { id: string; slug: string; address: string; owner: string | null; contractor: string | null; keyId: string | null; orgId: string | null; createdAt: string }[];
  captures: { id: string; recordId: string; stage: string; jobId: string | null; state: string; sourceUrl: string | null; frames: string[]; glbUrl: string | null; job: unknown; quality: unknown; parts: unknown[]; score: number | null; notes: string | null; createdAt: string; updatedAt: string }[];
  projectAccess: { id: string; recordId: string; orgId: string; role: "owner" | "collaborator"; addedByUserId: string | null; createdAt: string }[];
  assignments: { id: string; recordId: string; assigneeUserId: string | null; assigneeOrgId: string | null; task: string; stage: string | null; status: "open" | "done"; assignedByUserId: string | null; createdAt: string }[];
  hires: { id: string; fromOrgId: string; toUserId: string | null; toOrgId: string | null; task: string; recordId: string | null; note: string | null; status: "offered" | "accepted" | "declined" | "completed"; createdByUserId: string | null; createdAt: string }[];
  passwordResets: { id: string; userId: string; tokenHash: string; issuedByUserId: string | null; expiresAt: string; usedAt: string | null; createdAt: string }[];
};

async function loadLegacy(): Promise<L> {
  if (file) {
    const d = JSON.parse(readFileSync(file, "utf8")) as Partial<L>;
    return { users: [], orgs: [], memberships: [], records: [], captures: [], projectAccess: [], assignments: [], hires: [], passwordResets: [], ...d } as L;
  }
  const postgres = (await import("postgres")).default;
  const sqlc = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const has = await sqlc`SELECT to_regclass('homefax.users') AS t`;
    if (!has[0]?.t) throw new Error("No legacy `homefax` schema in this database and no --file given");
    const q = async <T,>(table: string): Promise<T[]> => (await sqlc.unsafe(`SELECT row_to_json(t) AS j FROM homefax.${table} t`)).map((r) => (r as unknown as { j: T }).j);
    const camel = <T,>(rows: Record<string, unknown>[]): T[] =>
      rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]))) as T[];
    return {
      users: camel(await q("users")),
      orgs: camel(await q("orgs")),
      memberships: camel(await q("memberships")),
      records: camel(await q("records")),
      captures: camel(await q("captures")),
      projectAccess: camel(await q("project_access")),
      assignments: camel(await q("assignments")),
      hires: camel(await q("hires")),
      passwordResets: camel(await q("password_resets")).map((r: any) => ({ ...r, userId: r.userId, issuedByUserId: r.issuedByUserId })),
    };
  } finally {
    await sqlc.end();
  }
}

function addressFor(text: string): { parts: AddressParts; partial: boolean } {
  const parsed = parseAddressLine(text);
  if (parsed) return { parts: parsed, partial: false };
  // "1418 Ridgemont Dr" or "Alpenrose Hotel — Room 412"
  const line1 = text.trim().replace(/\s+/g, " ").slice(0, 120) || "Unknown address";
  return { parts: { line1, city: defaults.city, state: defaults.state, postalCode: defaults.zip }, partial: true };
}

const legacy = await loadLegacy();
const db = await import("../src/index");
const { withService, schema } = db;
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

await withService(async (tx) => {
  for (const u of legacy.users) {
    if (await db.auth.getIdentity(tx, u.id)) continue;
    const email = u.email.toLowerCase().trim();
    const clash = await db.auth.getIdentityByEmail(tx, email);
    if (clash) {
      console.warn(`skip user ${u.id}: email ${email} already belongs to ${clash.id}`);
      continue;
    }
    await tx.insert(schema.identities).values({ id: u.id, email, createdAt: new Date(u.createdAt) });
    await tx.insert(schema.credentials).values({ identityId: u.id, passwordHash: u.passwordHash });
    let handle = u.handle.toLowerCase();
    if (await db.people.getProfileByHandle(tx, handle)) handle = `${handle.slice(0, 19)}-${newId().slice(0, 4).toLowerCase()}`;
    await tx.insert(schema.profiles).values({ identityId: u.id, name: u.name, handle, headline: u.headline, bio: u.bio, isPublic: u.isPublic });
    bump("identities");
  }
  for (const o of legacy.orgs) {
    if (await db.orgs.getOrg(tx, o.id)) continue;
    let slug = o.slug;
    if (await db.orgs.getOrgBySlug(tx, slug)) slug = `${slug.slice(0, 43)}-${newId().slice(0, 4).toLowerCase()}`;
    await tx.insert(schema.organizations).values({ id: o.id, kind: "contractor", name: o.name, slug, headline: o.headline, bio: o.bio, isPublic: o.isPublic, hfxKey: o.hfxKey, ownerIdentityId: o.ownerUserId, legacyKeyId: o.claimedKeyId, createdAt: new Date(o.createdAt) });
    bump("organizations");
  }
  for (const m of legacy.memberships) {
    if (await db.orgs.getMembershipById(tx, m.id)) continue;
    if (await db.orgs.getMembership(tx, m.orgId, m.userId)) continue;
    await tx.insert(schema.memberships).values({ id: m.id, orgId: m.orgId, identityId: m.userId, role: m.role, title: m.title, createdAt: new Date(m.createdAt) });
    bump("memberships");
  }
  const orgNames = new Map(legacy.orgs.map((o) => [o.id, o.name]));
  for (const r of legacy.records) {
    if (await db.records.getRecord(tx, r.id)) continue;
    const { parts, partial } = addressFor(r.address);
    const { property } = await db.properties.findOrCreateProperty(tx, { ...parts, createdBy: null });
    let slug = r.slug;
    if (await db.records.getRecordBySlug(tx, slug)) slug = `${slug.slice(0, 55)}-${newId().slice(0, 4).toLowerCase()}`;
    await tx.insert(schema.records).values({
      id: r.id,
      slug,
      propertyId: property.id,
      orgId: r.orgId,
      title: partial ? `Imported — address needs city/state/ZIP confirmed (was "${r.address}")` : null,
      ownerName: r.owner,
      contractorName: r.contractor ?? (r.orgId ? orgNames.get(r.orgId) ?? null : null),
      legacyKeyId: r.keyId,
      openedAt: new Date(r.createdAt),
      createdAt: new Date(r.createdAt),
    });
    if (r.orgId) await db.records.grantRecordAccess(tx, { recordId: r.id, orgId: r.orgId, role: "owner" });
    await db.properties.addEvent(tx, { propertyId: property.id, kind: "record_opened", title: `${r.contractor ?? "A contractor"} opened the build record`, actorOrgId: r.orgId, visibility: "summary" });
    bump("records");
  }
  for (const pa of legacy.projectAccess) {
    if (!(await db.records.getRecord(tx, pa.recordId))) continue;
    await db.records.grantRecordAccess(tx, { recordId: pa.recordId, orgId: pa.orgId, role: pa.role, addedBy: pa.addedByUserId });
    bump("record_access");
  }
  for (const c of legacy.captures) {
    if (await db.records.getCapture(tx, c.id)) continue;
    const rec = await db.records.getRecord(tx, c.recordId);
    if (!rec) continue;
    const stage = c.stage as import("@homefax/core").StageId;
    await tx.delete(schema.captures).where(and(eq(schema.captures.recordId, rec.id), eq(schema.captures.stage, stage)));
    await tx.insert(schema.captures).values({
      id: c.id,
      recordId: rec.id,
      propertyId: rec.propertyId,
      stage,
      jobId: c.jobId,
      state: c.state === "done" ? "queued" : c.state,
      sourceUrl: c.sourceUrl,
      frames: c.frames ?? [],
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    });
    if (c.state === "done" && c.quality && c.job) {
      await db.records.finalizeCapture(tx, c.id, { job: c.job as never, glbUrl: c.glbUrl, quality: c.quality as never, parts: (c.parts ?? []) as never, notes: c.notes });
    } else if (c.state === "failed") {
      await tx.update(schema.captures).set({ state: "failed", job: c.job as never }).where(eq(schema.captures.id, c.id));
    }
    bump("captures");
  }
  for (const a of legacy.assignments) {
    if (await db.records.getAssignment(tx, a.id)) continue;
    if (!(await db.records.getRecord(tx, a.recordId))) continue;
    await tx.insert(schema.assignments).values({ id: a.id, recordId: a.recordId, assigneeIdentityId: a.assigneeUserId, assigneeOrgId: a.assigneeOrgId, task: a.task, stage: a.stage as never, status: a.status, assignedBy: a.assignedByUserId, createdAt: new Date(a.createdAt) });
    bump("assignments");
  }
  for (const h of legacy.hires) {
    if (await db.records.getHire(tx, h.id)) continue;
    await tx.insert(schema.hires).values({ id: h.id, fromOrgId: h.fromOrgId, toIdentityId: h.toUserId, toOrgId: h.toOrgId, task: h.task, recordId: h.recordId, note: h.note, status: h.status, createdBy: h.createdByUserId, createdAt: new Date(h.createdAt) });
    bump("hires");
  }
  for (const p of legacy.passwordResets) {
    if (p.usedAt || new Date(p.expiresAt) < new Date()) continue;
    const exists = await tx.select({ id: schema.passwordResets.id }).from(schema.passwordResets).where(eq(schema.passwordResets.id, p.id)).limit(1);
    if (exists.length) continue;
    await tx.insert(schema.passwordResets).values({ id: p.id, identityId: p.userId, tokenHash: p.tokenHash, issuedBy: p.issuedByUserId, expiresAt: new Date(p.expiresAt), createdAt: new Date(p.createdAt) });
    bump("password_resets");
  }
  // Stats for every imported property.
  const props = await tx.select({ id: schema.properties.id }).from(schema.properties);
  for (const p of props) await tx.execute(sql`SELECT property.recompute_stats(${p.id})`);
  void isNull;
});

console.log("imported:", counts);
await db.closePool();
