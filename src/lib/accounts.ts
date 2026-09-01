import { and, eq, inArray, or } from "drizzle-orm";
import { promises as fs } from "node:fs";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import path from "node:path";
import { currentUserId, mintHfxKey } from "./auth";
import { dbConfigured, getDb, schema } from "./db";
import { getDataFile, listRecordsForOrg } from "./store";
import type { StageId } from "./types";

/**
 * Accounts, companies, hiring, and assignments — the people layer over the
 * records store. Same dual-backend rule as store.ts: Postgres when
 * DATABASE_URL is set, the .data/store.json file otherwise, one behaviour.
 *
 * NOTE: bodies are being implemented against this exact surface; every
 * signature and type here is the contract the pages are built on.
 */

/* -------------------------------- types --------------------------------- */

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  handle: string;
  headline: string | null;
  bio: string | null;
  isPublic: boolean;
  createdAt: string;
};

/** A user with the private fields stripped — safe for the hire board. */
export type PublicUser = Omit<User, "email" | "passwordHash">;

export type Org = {
  id: string;
  name: string;
  slug: string;
  headline: string | null;
  bio: string | null;
  isPublic: boolean;
  /** The company's HomeFAX key (`hfx_…`) — quote it to be added to a project. */
  hfxKey: string;
  ownerUserId: string;
  claimedKeyId: string | null;
  createdAt: string;
};

export type PublicOrg = Omit<Org, "hfxKey" | "claimedKeyId" | "ownerUserId">;

export type Membership = {
  id: string;
  orgId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  title: string | null;
  createdAt: string;
};

export type Member = { membership: Membership; user: PublicUser };

export type ProjectAccess = {
  id: string;
  recordId: string;
  orgId: string;
  role: "owner" | "collaborator";
  addedByUserId: string | null;
  createdAt: string;
};

export type Assignment = {
  id: string;
  recordId: string;
  assigneeUserId: string | null;
  assigneeOrgId: string | null;
  task: string;
  stage: StageId | null;
  status: "open" | "done";
  assignedByUserId: string | null;
  createdAt: string;
};

export type Hire = {
  id: string;
  fromOrgId: string;
  toUserId: string | null;
  toOrgId: string | null;
  task: string;
  recordId: string | null;
  note: string | null;
  status: "offered" | "accepted" | "declined" | "completed";
  createdByUserId: string | null;
  createdAt: string;
};

/* ---------------------------- file backend shape ------------------------- */

type AccountsFileShape = {
  /** Preserved opaquely from store.ts side. */
  records?: unknown[];
  captures?: unknown[];
  /** Accounts data owned here. */
  users: User[];
  orgs: Org[];
  memberships: Membership[];
  projectAccess: ProjectAccess[];
  assignments: Assignment[];
  hires: Hire[];
};

async function readAccountsFile(): Promise<AccountsFileShape> {
  const file = getDataFile();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<AccountsFileShape>;
    return {
      records: parsed.records,
      captures: parsed.captures,
      users: (parsed.users ?? []) as User[],
      orgs: (parsed.orgs ?? []) as Org[],
      memberships: (parsed.memberships ?? []) as Membership[],
      projectAccess: (parsed.projectAccess ?? []) as ProjectAccess[],
      assignments: (parsed.assignments ?? []) as Assignment[],
      hires: (parsed.hires ?? []) as Hire[],
    };
  } catch {
    return {
      users: [],
      orgs: [],
      memberships: [],
      projectAccess: [],
      assignments: [],
      hires: [],
    };
  }
}

async function writeAccountsFile(data: AccountsFileShape): Promise<void> {
  const file = getDataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

/* -------------------------------- helpers ------------------------------- */

function isPostgres(): boolean {
  return dbConfigured;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "org"
  );
}

function toPublicUser(u: User): PublicUser {
  const pub = { ...u } as Partial<User>;
  delete pub.email;
  delete pub.passwordHash;
  return pub as PublicUser;
}

function toPublicOrg(o: Org): PublicOrg {
  const pub = { ...o } as Partial<Org>;
  delete pub.hfxKey;
  delete pub.claimedKeyId;
  delete pub.ownerUserId;
  return pub as PublicOrg;
}

/* ----------------------- postgres mappers -------------------------------- */

function userFromRow(r: typeof schema.users.$inferSelect): User {
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.passwordHash,
    name: r.name,
    handle: r.handle,
    headline: r.headline,
    bio: r.bio,
    isPublic: r.isPublic,
    createdAt: r.createdAt.toISOString(),
  };
}

function orgFromRow(r: typeof schema.orgs.$inferSelect): Org {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    headline: r.headline,
    bio: r.bio,
    isPublic: r.isPublic,
    hfxKey: r.hfxKey,
    ownerUserId: r.ownerUserId,
    claimedKeyId: r.claimedKeyId,
    createdAt: r.createdAt.toISOString(),
  };
}

function membershipFromRow(r: typeof schema.memberships.$inferSelect): Membership {
  return {
    id: r.id,
    orgId: r.orgId,
    userId: r.userId,
    role: r.role,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
  };
}

function projectAccessFromRow(r: typeof schema.projectAccess.$inferSelect): ProjectAccess {
  return {
    id: r.id,
    recordId: r.recordId,
    orgId: r.orgId,
    role: r.role,
    addedByUserId: r.addedByUserId,
    createdAt: r.createdAt.toISOString(),
  };
}

function assignmentFromRow(r: typeof schema.assignments.$inferSelect): Assignment {
  return {
    id: r.id,
    recordId: r.recordId,
    assigneeUserId: r.assigneeUserId,
    assigneeOrgId: r.assigneeOrgId,
    task: r.task,
    stage: r.stage,
    status: r.status,
    assignedByUserId: r.assignedByUserId,
    createdAt: r.createdAt.toISOString(),
  };
}

function hireFromRow(r: typeof schema.hires.$inferSelect): Hire {
  return {
    id: r.id,
    fromOrgId: r.fromOrgId,
    toUserId: r.toUserId,
    toOrgId: r.toOrgId,
    task: r.task,
    recordId: r.recordId,
    note: r.note,
    status: r.status,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
  };
}

/* ------------------------- session-adjacent reads ------------------------ */

export const ORG_COOKIE = "hfx_org";

/** The signed-in user, or null. */
export async function currentUser(): Promise<User | null> {
  const id = await currentUserId();
  if (!id) return null;
  return getUser(id);
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

/**
 * The company the user is currently acting as: the org cookie when it names
 * an org they belong to, else their first org, else null.
 */
export async function activeOrg(userId: string): Promise<Org | null> {
  const jar = await cookies();
  const wanted = jar.get(ORG_COOKIE)?.value;
  const orgsForUser = await listOrgsForUser(userId);
  if (orgsForUser.length === 0) return null;
  return orgsForUser.find((o) => o.id === wanted) ?? orgsForUser[0];
}

/* -------------------------------- users --------------------------------- */

export async function getUser(id: string): Promise<User | null> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return rows[0] ? userFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.users.find((u) => u.id === id) ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const normalized = email.toLowerCase().trim();
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalized))
      .limit(1);
    return rows[0] ? userFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.users.find((u) => u.email === normalized) ?? null;
}

export async function getUserByHandle(handle: string): Promise<User | null> {
  const normalized = handle.toLowerCase().trim();
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.handle, normalized))
      .limit(1);
    return rows[0] ? userFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.users.find((u) => u.handle === normalized) ?? null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
  handle: string;
  headline?: string;
}): Promise<User> {
  const email = input.email.toLowerCase().trim();
  const handle = input.handle.toLowerCase().trim();

  // Validate handle format: [a-z0-9-], 3-24 chars
  if (!/^[a-z0-9-]{3,24}$/.test(handle)) {
    throw new Error("Handle must be 3–24 characters and contain only lowercase letters, numbers, and hyphens");
  }

  if (isPostgres()) {
    const db = getDb();
    const existing = await db
      .select({ id: schema.users.id, handle: schema.users.handle })
      .from(schema.users)
      .where(or(eq(schema.users.email, email), eq(schema.users.handle, handle)));
    for (const row of existing) {
      if (row.handle === handle) throw new Error("That handle is taken");
    }
    if (existing.length > 0) throw new Error("That email already has an account");

    const id = nanoid(12);
    const now = new Date();
    await db.insert(schema.users).values({
      id,
      email,
      passwordHash: input.passwordHash,
      name: input.name,
      handle,
      headline: input.headline ?? null,
    });
    return {
      id,
      email,
      passwordHash: input.passwordHash,
      name: input.name,
      handle,
      headline: input.headline ?? null,
      bio: null,
      isPublic: false,
      createdAt: now.toISOString(),
    };
  }

  const d = await readAccountsFile();
  if (d.users.some((u) => u.email === email)) throw new Error("That email already has an account");
  if (d.users.some((u) => u.handle === handle)) throw new Error("That handle is taken");

  const user: User = {
    id: nanoid(12),
    email,
    passwordHash: input.passwordHash,
    name: input.name,
    handle,
    headline: input.headline ?? null,
    bio: null,
    isPublic: false,
    createdAt: new Date().toISOString(),
  };
  d.users.push(user);
  await writeAccountsFile(d);
  return user;
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, "name" | "handle" | "headline" | "bio" | "isPublic">>,
): Promise<void> {
  if (patch.handle !== undefined) {
    const handle = patch.handle.toLowerCase().trim();
    if (!/^[a-z0-9-]{3,24}$/.test(handle)) {
      throw new Error("Handle must be 3–24 characters and contain only lowercase letters, numbers, and hyphens");
    }
    patch = { ...patch, handle };
  }

  if (isPostgres()) {
    const db = getDb();
    await db.update(schema.users).set(patch).where(eq(schema.users.id, id));
    return;
  }
  const d = await readAccountsFile();
  const idx = d.users.findIndex((u) => u.id === id);
  if (idx < 0) return;
  if (patch.handle) {
    const clash = d.users.find((u) => u.handle === patch.handle && u.id !== id);
    if (clash) throw new Error("That handle is taken");
  }
  d.users[idx] = { ...d.users[idx], ...patch };
  await writeAccountsFile(d);
}

/* --------------------------------- orgs ---------------------------------- */

export async function createOrg(input: {
  name: string;
  ownerUserId: string;
  headline?: string;
}): Promise<Org> {
  const hfxKey = mintHfxKey();
  const baseSlug = slugify(input.name);

  if (isPostgres()) {
    const db = getDb();
    let slug = baseSlug;
    for (let i = 0; i < 10; i++) {
      const clash = await db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(eq(schema.orgs.slug, slug))
        .limit(1);
      if (clash.length === 0) break;
      slug = `${baseSlug}-${nanoid(4).toLowerCase()}`;
    }
    const id = nanoid(12);
    await db.insert(schema.orgs).values({
      id,
      name: input.name,
      slug,
      headline: input.headline ?? null,
      hfxKey,
      ownerUserId: input.ownerUserId,
    });
    // Owner membership
    await db.insert(schema.memberships).values({
      id: nanoid(12),
      orgId: id,
      userId: input.ownerUserId,
      role: "owner",
    });
    return {
      id,
      name: input.name,
      slug,
      headline: input.headline ?? null,
      bio: null,
      isPublic: false,
      hfxKey,
      ownerUserId: input.ownerUserId,
      claimedKeyId: null,
      createdAt: new Date().toISOString(),
    };
  }

  const d = await readAccountsFile();
  let slug = baseSlug;
  for (let i = 0; i < 10; i++) {
    if (!d.orgs.some((o) => o.slug === slug)) break;
    slug = `${baseSlug}-${nanoid(4).toLowerCase()}`;
  }
  const id = nanoid(12);
  const now = new Date().toISOString();
  const org: Org = {
    id,
    name: input.name,
    slug,
    headline: input.headline ?? null,
    bio: null,
    isPublic: false,
    hfxKey,
    ownerUserId: input.ownerUserId,
    claimedKeyId: null,
    createdAt: now,
  };
  const membership: Membership = {
    id: nanoid(12),
    orgId: id,
    userId: input.ownerUserId,
    role: "owner",
    title: null,
    createdAt: now,
  };
  d.orgs.push(org);
  d.memberships.push(membership);
  await writeAccountsFile(d);
  return org;
}

export async function getOrg(id: string): Promise<Org | null> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, id))
      .limit(1);
    return rows[0] ? orgFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.orgs.find((o) => o.id === id) ?? null;
}

export async function getOrgByHfxKey(hfxKey: string): Promise<Org | null> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.hfxKey, hfxKey))
      .limit(1);
    return rows[0] ? orgFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.orgs.find((o) => o.hfxKey === hfxKey) ?? null;
}

export async function updateOrg(
  id: string,
  patch: Partial<Pick<Org, "name" | "headline" | "bio" | "isPublic" | "hfxKey" | "claimedKeyId">>,
): Promise<void> {
  if (isPostgres()) {
    const db = getDb();
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.headline !== undefined) dbPatch.headline = patch.headline;
    if (patch.bio !== undefined) dbPatch.bio = patch.bio;
    if (patch.isPublic !== undefined) dbPatch.isPublic = patch.isPublic;
    if (patch.hfxKey !== undefined) dbPatch.hfxKey = patch.hfxKey;
    if (patch.claimedKeyId !== undefined) dbPatch.claimedKeyId = patch.claimedKeyId;
    await db.update(schema.orgs).set(dbPatch).where(eq(schema.orgs.id, id));
    return;
  }
  const d = await readAccountsFile();
  const idx = d.orgs.findIndex((o) => o.id === id);
  if (idx < 0) return;
  d.orgs[idx] = { ...d.orgs[idx], ...patch };
  await writeAccountsFile(d);
}

export async function listOrgsForUser(userId: string): Promise<Org[]> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select({ org: schema.orgs })
      .from(schema.orgs)
      .innerJoin(schema.memberships, eq(schema.memberships.orgId, schema.orgs.id))
      .where(eq(schema.memberships.userId, userId));
    return rows.map((r) => orgFromRow(r.org));
  }
  const d = await readAccountsFile();
  const orgIds = new Set(d.memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
  return d.orgs.filter((o) => orgIds.has(o.id));
}

/* ------------------------------ memberships ------------------------------ */

export async function addMembership(input: {
  orgId: string;
  userId: string;
  role: Membership["role"];
  title?: string;
}): Promise<Membership> {
  if (isPostgres()) {
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.orgId, input.orgId), eq(schema.memberships.userId, input.userId)),
      )
      .limit(1);
    if (existing[0]) return membershipFromRow(existing[0]);

    const id = nanoid(12);
    await db.insert(schema.memberships).values({
      id,
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      title: input.title ?? null,
    });
    return {
      id,
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      title: input.title ?? null,
      createdAt: new Date().toISOString(),
    };
  }
  const d = await readAccountsFile();
  const existing = d.memberships.find(
    (m) => m.orgId === input.orgId && m.userId === input.userId,
  );
  if (existing) return existing;

  const membership: Membership = {
    id: nanoid(12),
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    title: input.title ?? null,
    createdAt: new Date().toISOString(),
  };
  d.memberships.push(membership);
  await writeAccountsFile(d);
  return membership;
}

export async function removeMembership(id: string): Promise<void> {
  if (isPostgres()) {
    const db = getDb();
    await db.delete(schema.memberships).where(eq(schema.memberships.id, id));
    return;
  }
  const d = await readAccountsFile();
  d.memberships = d.memberships.filter((m) => m.id !== id);
  await writeAccountsFile(d);
}

export async function listMembers(orgId: string): Promise<Member[]> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select({ membership: schema.memberships, user: schema.users })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.orgId, orgId));
    return rows.map((r) => ({
      membership: membershipFromRow(r.membership),
      user: toPublicUser(userFromRow(r.user)),
    }));
  }
  const d = await readAccountsFile();
  const ms = d.memberships.filter((m) => m.orgId === orgId);
  const result: Member[] = [];
  for (const m of ms) {
    const user = d.users.find((u) => u.id === m.userId);
    if (user) result.push({ membership: m, user: toPublicUser(user) });
  }
  return result;
}

export async function getMembership(orgId: string, userId: string): Promise<Membership | null> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)),
      )
      .limit(1);
    return rows[0] ? membershipFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.memberships.find((m) => m.orgId === orgId && m.userId === userId) ?? null;
}

/** Internal: look up a membership by its id. */
async function getMembershipById(id: string): Promise<Membership | null> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, id))
      .limit(1);
    return rows[0] ? membershipFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.memberships.find((m) => m.id === id) ?? null;
}

export { getMembershipById };

/* ----------------------------- project access ---------------------------- */

export async function grantProjectAccess(input: {
  recordId: string;
  orgId: string;
  role: ProjectAccess["role"];
  addedByUserId?: string;
}): Promise<ProjectAccess> {
  if (isPostgres()) {
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.projectAccess)
      .where(
        and(
          eq(schema.projectAccess.recordId, input.recordId),
          eq(schema.projectAccess.orgId, input.orgId),
        ),
      )
      .limit(1);
    if (existing[0]) return projectAccessFromRow(existing[0]);

    const id = nanoid(12);
    await db.insert(schema.projectAccess).values({
      id,
      recordId: input.recordId,
      orgId: input.orgId,
      role: input.role,
      addedByUserId: input.addedByUserId ?? null,
    });
    return {
      id,
      recordId: input.recordId,
      orgId: input.orgId,
      role: input.role,
      addedByUserId: input.addedByUserId ?? null,
      createdAt: new Date().toISOString(),
    };
  }
  const d = await readAccountsFile();
  const existing = d.projectAccess.find(
    (pa) => pa.recordId === input.recordId && pa.orgId === input.orgId,
  );
  if (existing) return existing;

  const access: ProjectAccess = {
    id: nanoid(12),
    recordId: input.recordId,
    orgId: input.orgId,
    role: input.role,
    addedByUserId: input.addedByUserId ?? null,
    createdAt: new Date().toISOString(),
  };
  d.projectAccess.push(access);
  await writeAccountsFile(d);
  return access;
}

export async function listProjectOrgs(
  recordId: string,
): Promise<{ access: ProjectAccess; org: PublicOrg }[]> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select({ access: schema.projectAccess, org: schema.orgs })
      .from(schema.projectAccess)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.projectAccess.orgId))
      .where(eq(schema.projectAccess.recordId, recordId));
    return rows.map((r) => ({
      access: projectAccessFromRow(r.access),
      org: toPublicOrg(orgFromRow(r.org)),
    }));
  }
  const d = await readAccountsFile();
  const pas = d.projectAccess.filter((pa) => pa.recordId === recordId);
  const result: { access: ProjectAccess; org: PublicOrg }[] = [];
  for (const access of pas) {
    const org = d.orgs.find((o) => o.id === access.orgId);
    if (org) result.push({ access, org: toPublicOrg(org) });
  }
  return result;
}

/** Record ids an org can open: owned rows plus collaborator grants. */
export async function accessibleRecordIds(orgId: string): Promise<string[]> {
  const rows = await listRecordsForOrg(orgId);
  return rows.map((r) => r.id);
}

/**
 * Whether this user may open this record: a membership in an org with access,
 * or a direct assignment on it.
 */
export async function canAccessRecord(userId: string, recordId: string): Promise<boolean> {
  const userOrgs = await listOrgsForUser(userId);
  for (const org of userOrgs) {
    const ids = await accessibleRecordIds(org.id);
    if (ids.includes(recordId)) return true;
  }

  const assignments = await listAssignmentsForRecord(recordId);
  if (assignments.some((a) => a.assigneeUserId === userId)) return true;

  const orgIds = new Set(userOrgs.map((o) => o.id));
  if (assignments.some((a) => a.assigneeOrgId !== null && orgIds.has(a.assigneeOrgId))) return true;

  return false;
}

/**
 * Stamp every legacy record created by `keyId` with this org and grant owner
 * access. Returns how many records moved.
 */
export async function claimLegacyRecords(orgId: string, keyId: string): Promise<number> {
  if (isPostgres()) {
    const db = getDb();
    const toStamp = await db
      .select()
      .from(schema.records)
      .where(
        and(eq(schema.records.keyId, keyId)),
      );
    const unclaimed = toStamp.filter((r) => r.orgId === null);
    if (unclaimed.length === 0) return 0;

    for (const record of unclaimed) {
      await db
        .update(schema.records)
        .set({ orgId })
        .where(eq(schema.records.id, record.id));
      await db
        .insert(schema.projectAccess)
        .values({
          id: nanoid(12),
          recordId: record.id,
          orgId,
          role: "owner",
        })
        .onConflictDoNothing();
    }
    await db.update(schema.orgs).set({ claimedKeyId: keyId }).where(eq(schema.orgs.id, orgId));
    return unclaimed.length;
  }

  const d = await readAccountsFile();
  const unclaimed = (d.records ?? []) as Array<{ id: string; keyId?: string | null; orgId?: string | null }>;
  const toStamp = unclaimed.filter((r) => r.keyId === keyId && r.orgId == null);
  if (toStamp.length === 0) return 0;

  for (const record of toStamp) {
    // Update orgId on the record (in the shared file — we own projectAccess but not records;
    // casting via unknown is safe here since we wrote the same file initially)
    (d.records as Array<Record<string, unknown>>).forEach((r) => {
      if (r.id === record.id) r.orgId = orgId;
    });
    // Grant access
    if (!d.projectAccess.some((pa) => pa.recordId === record.id && pa.orgId === orgId)) {
      d.projectAccess.push({
        id: nanoid(12),
        recordId: record.id,
        orgId,
        role: "owner",
        addedByUserId: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
  const orgIdx = d.orgs.findIndex((o) => o.id === orgId);
  if (orgIdx >= 0) d.orgs[orgIdx].claimedKeyId = keyId;
  await writeAccountsFile(d);
  return toStamp.length;
}

/* ------------------------------ assignments ------------------------------ */

export async function createAssignment(input: {
  recordId: string;
  assigneeUserId?: string;
  assigneeOrgId?: string;
  task: string;
  stage?: StageId;
  assignedByUserId?: string;
}): Promise<Assignment> {
  if (isPostgres()) {
    const db = getDb();
    const id = nanoid(12);
    await db.insert(schema.assignments).values({
      id,
      recordId: input.recordId,
      assigneeUserId: input.assigneeUserId ?? null,
      assigneeOrgId: input.assigneeOrgId ?? null,
      task: input.task,
      stage: input.stage ?? null,
      assignedByUserId: input.assignedByUserId ?? null,
    });
    return {
      id,
      recordId: input.recordId,
      assigneeUserId: input.assigneeUserId ?? null,
      assigneeOrgId: input.assigneeOrgId ?? null,
      task: input.task,
      stage: input.stage ?? null,
      status: "open",
      assignedByUserId: input.assignedByUserId ?? null,
      createdAt: new Date().toISOString(),
    };
  }
  const d = await readAccountsFile();
  const assignment: Assignment = {
    id: nanoid(12),
    recordId: input.recordId,
    assigneeUserId: input.assigneeUserId ?? null,
    assigneeOrgId: input.assigneeOrgId ?? null,
    task: input.task,
    stage: input.stage ?? null,
    status: "open",
    assignedByUserId: input.assignedByUserId ?? null,
    createdAt: new Date().toISOString(),
  };
  d.assignments.push(assignment);
  await writeAccountsFile(d);
  return assignment;
}

export async function setAssignmentStatus(id: string, status: Assignment["status"]): Promise<void> {
  if (isPostgres()) {
    const db = getDb();
    await db
      .update(schema.assignments)
      .set({ status })
      .where(eq(schema.assignments.id, id));
    return;
  }
  const d = await readAccountsFile();
  const idx = d.assignments.findIndex((a) => a.id === id);
  if (idx >= 0) d.assignments[idx].status = status;
  await writeAccountsFile(d);
}

export async function getAssignment(id: string): Promise<Assignment | null> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, id))
      .limit(1);
    return rows[0] ? assignmentFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.assignments.find((a) => a.id === id) ?? null;
}

export async function listAssignmentsForRecord(recordId: string): Promise<Assignment[]> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.recordId, recordId));
    return rows.map(assignmentFromRow);
  }
  const d = await readAccountsFile();
  return d.assignments.filter((a) => a.recordId === recordId);
}

/** Direct assignments to this person (not via their orgs). */
export async function listAssignmentsForUser(userId: string): Promise<Assignment[]> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.assigneeUserId, userId));
    return rows.map(assignmentFromRow);
  }
  const d = await readAccountsFile();
  return d.assignments.filter((a) => a.assigneeUserId === userId);
}

export async function listAssignmentsForOrg(orgId: string): Promise<Assignment[]> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.assigneeOrgId, orgId));
    return rows.map(assignmentFromRow);
  }
  const d = await readAccountsFile();
  return d.assignments.filter((a) => a.assigneeOrgId === orgId);
}

/* --------------------------------- hires --------------------------------- */

export async function createHire(input: {
  fromOrgId: string;
  toUserId?: string;
  toOrgId?: string;
  task: string;
  recordId?: string;
  note?: string;
  createdByUserId?: string;
}): Promise<Hire> {
  if (isPostgres()) {
    const db = getDb();
    const id = nanoid(12);
    await db.insert(schema.hires).values({
      id,
      fromOrgId: input.fromOrgId,
      toUserId: input.toUserId ?? null,
      toOrgId: input.toOrgId ?? null,
      task: input.task,
      recordId: input.recordId ?? null,
      note: input.note ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });
    return {
      id,
      fromOrgId: input.fromOrgId,
      toUserId: input.toUserId ?? null,
      toOrgId: input.toOrgId ?? null,
      task: input.task,
      recordId: input.recordId ?? null,
      note: input.note ?? null,
      status: "offered",
      createdByUserId: input.createdByUserId ?? null,
      createdAt: new Date().toISOString(),
    };
  }
  const d = await readAccountsFile();
  const hire: Hire = {
    id: nanoid(12),
    fromOrgId: input.fromOrgId,
    toUserId: input.toUserId ?? null,
    toOrgId: input.toOrgId ?? null,
    task: input.task,
    recordId: input.recordId ?? null,
    note: input.note ?? null,
    status: "offered",
    createdByUserId: input.createdByUserId ?? null,
    createdAt: new Date().toISOString(),
  };
  d.hires.push(hire);
  await writeAccountsFile(d);
  return hire;
}

export async function getHire(id: string): Promise<Hire | null> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.hires)
      .where(eq(schema.hires.id, id))
      .limit(1);
    return rows[0] ? hireFromRow(rows[0]) : null;
  }
  const d = await readAccountsFile();
  return d.hires.find((h) => h.id === id) ?? null;
}

export async function setHireStatus(id: string, status: Hire["status"]): Promise<void> {
  if (isPostgres()) {
    const db = getDb();
    await db.update(schema.hires).set({ status }).where(eq(schema.hires.id, id));
    return;
  }
  const d = await readAccountsFile();
  const idx = d.hires.findIndex((h) => h.id === id);
  if (idx >= 0) d.hires[idx].status = status;
  await writeAccountsFile(d);
}

/** Offers this company has sent. */
export async function listHiresFromOrg(orgId: string): Promise<Hire[]> {
  if (isPostgres()) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.hires)
      .where(eq(schema.hires.fromOrgId, orgId));
    return rows.map(hireFromRow);
  }
  const d = await readAccountsFile();
  return d.hires.filter((h) => h.fromOrgId === orgId);
}

/** Offers addressed to this person, or to any org they own/admin. */
export async function listIncomingHires(userId: string): Promise<Hire[]> {
  if (isPostgres()) {
    const db = getDb();
    // Get orgs where user is owner/admin
    const adminMemberships = await db
      .select({ orgId: schema.memberships.orgId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, userId),
          or(eq(schema.memberships.role, "owner"), eq(schema.memberships.role, "admin")),
        ),
      );
    const orgIds = adminMemberships.map((m) => m.orgId);
    const conditions = [eq(schema.hires.toUserId, userId)];
    if (orgIds.length > 0) {
      conditions.push(inArray(schema.hires.toOrgId, orgIds));
    }
    const rows = await db
      .select()
      .from(schema.hires)
      .where(or(...conditions));
    return rows.map(hireFromRow);
  }
  const d = await readAccountsFile();
  const adminOrgIds = new Set(
    d.memberships
      .filter((m) => m.userId === userId && (m.role === "owner" || m.role === "admin"))
      .map((m) => m.orgId),
  );
  return d.hires.filter(
    (h) => h.toUserId === userId || (h.toOrgId !== null && adminOrgIds.has(h.toOrgId)),
  );
}

/* ------------------------------ hire board ------------------------------- */

export async function listPublicProfiles(): Promise<{ users: PublicUser[]; orgs: PublicOrg[] }> {
  if (isPostgres()) {
    const db = getDb();
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.isPublic, true));
    const orgRows = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.isPublic, true));
    return {
      users: userRows.map((r) => toPublicUser(userFromRow(r))),
      orgs: orgRows.map((r) => toPublicOrg(orgFromRow(r))),
    };
  }
  const d = await readAccountsFile();
  return {
    users: d.users.filter((u) => u.isPublic).map(toPublicUser),
    orgs: d.orgs.filter((o) => o.isPublic).map(toPublicOrg),
  };
}
