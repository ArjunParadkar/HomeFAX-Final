import {
  boolean,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  PartLine,
  QualityReport,
  ReconJob,
  StageId,
} from "../types";

/** Kept in its own schema so the database can be shared without collisions. */
export const homefax = pgSchema("homefax");

/* ------------------------------ accounts ------------------------------- */

/** A person. Every sign-in is a person; companies are orgs they belong to. */
export const users = homefax.table(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    /** scrypt, formatted `scrypt:N:r:p:saltB64:hashB64`. */
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    /** Public handle, unique, lowercase. */
    handle: text("handle").notNull(),
    /** Trade line shown on the public card, e.g. "Journeyman electrician". */
    headline: text("headline"),
    bio: text("bio"),
    /** Public profiles appear on the hire board. */
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_handle_idx").on(t.handle),
  ],
);

/** A company. Owns records; carries the HomeFAX key others use to add it to a project. */
export const orgs = homefax.table(
  "orgs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    headline: text("headline"),
    bio: text("bio"),
    isPublic: boolean("is_public").notNull().default(false),
    /** The company's HomeFAX key, `hfx_…` — quote it to be added to someone's project. */
    hfxKey: text("hfx_key").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    /** Legacy ACCESS_KEYS id this org has claimed, if any. */
    claimedKeyId: text("claimed_key_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orgs_slug_idx").on(t.slug),
    uniqueIndex("orgs_hfx_key_idx").on(t.hfxKey),
  ],
);

export const memberships = homefax.table(
  "memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "admin" | "member">().notNull().default("member"),
    /** What they do for this company, e.g. "Framing crew lead". */
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_org_user_idx").on(t.orgId, t.userId)],
);

/** A company granted access to a record — the project team, incl. the owner org. */
export const projectAccess = homefax.table(
  "project_access",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "collaborator">().notNull().default("collaborator"),
    addedByUserId: text("added_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("project_access_record_org_idx").on(t.recordId, t.orgId)],
);

/** A person or company put on a specific property for a specific task. */
export const assignments = homefax.table("assignments", {
  id: text("id").primaryKey(),
  recordId: text("record_id")
    .notNull()
    .references(() => records.id, { onDelete: "cascade" }),
  /** Exactly one of these is set. */
  assigneeUserId: text("assignee_user_id").references(() => users.id, { onDelete: "cascade" }),
  assigneeOrgId: text("assignee_org_id").references(() => orgs.id, { onDelete: "cascade" }),
  task: text("task").notNull(),
  stage: text("stage").$type<StageId>(),
  status: text("status").$type<"open" | "done">().notNull().default("open"),
  assignedByUserId: text("assigned_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A hire offer from the board: company → person or company, for a task. */
export const hires = homefax.table("hires", {
  id: text("id").primaryKey(),
  fromOrgId: text("from_org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  /** Exactly one of these is set. */
  toUserId: text("to_user_id").references(() => users.id, { onDelete: "cascade" }),
  toOrgId: text("to_org_id").references(() => orgs.id, { onDelete: "cascade" }),
  task: text("task").notNull(),
  recordId: text("record_id").references(() => records.id, { onDelete: "set null" }),
  note: text("note"),
  status: text("status")
    .$type<"offered" | "accepted" | "declined" | "completed">()
    .notNull()
    .default("offered"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------- records -------------------------------- */

export const records = homefax.table(
  "records",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    address: text("address").notNull(),
    owner: text("owner"),
    contractor: text("contractor"),
    /** Which legacy access key created it — kept for claim migration. */
    keyId: text("key_id"),
    /** The company that owns the record — the tenant boundary going forward. */
    orgId: text("org_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("records_slug_idx").on(t.slug)],
);

export const captures = homefax.table(
  "captures",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    stage: text("stage").$type<StageId>().notNull(),
    /** RunPod job id, or a local id in demo mode. */
    jobId: text("job_id"),
    state: text("state").notNull().default("queued"),
    sourceUrl: text("source_url"),
    frames: jsonb("frames").$type<string[]>().default([]),
    glbUrl: text("glb_url"),
    job: jsonb("job").$type<ReconJob>(),
    quality: jsonb("quality").$type<QualityReport>(),
    parts: jsonb("parts").$type<PartLine[]>().default([]),
    score: real("score"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("captures_record_stage_idx").on(t.recordId, t.stage)],
);

export type RecordRow = typeof records.$inferSelect;
export type CaptureRow = typeof captures.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type OrgRow = typeof orgs.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type ProjectAccessRow = typeof projectAccess.$inferSelect;
export type AssignmentRow = typeof assignments.$inferSelect;
export type HireRow = typeof hires.$inferSelect;
