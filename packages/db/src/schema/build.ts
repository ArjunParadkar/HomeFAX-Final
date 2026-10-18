import { boolean, integer, jsonb, pgSchema, real, text, timestamp } from "drizzle-orm/pg-core";
import type { PartLine, QualityReport, ReconJob, StageId } from "@homefax/core";
import { identities } from "./auth";
import { organizations } from "./org";
import { properties } from "./property";

export const buildSchema = pgSchema("build");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const records = buildSchema.table("records", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
  title: text("title"),
  status: text("status").$type<"open" | "complete" | "archived">().notNull().default("open"),
  ownerName: text("owner_name"),
  contractorName: text("contractor_name"),
  legacyKeyId: text("legacy_key_id"),
  createdBy: text("created_by").references(() => identities.id, { onDelete: "set null" }),
  openedAt: ts("opened_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const recordAccess = buildSchema.table("record_access", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: text("role").$type<"owner" | "collaborator">().notNull().default("collaborator"),
  addedBy: text("added_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const captures = buildSchema.table("captures", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  stage: text("stage").$type<StageId>().notNull(),
  jobId: text("job_id"),
  state: text("state").notNull().default("queued"),
  sourceUrl: text("source_url"),
  frames: jsonb("frames").$type<string[]>().notNull().default([]),
  glbUrl: text("glb_url"),
  job: jsonb("job").$type<ReconJob>(),
  quality: jsonb("quality").$type<QualityReport>(),
  parts: jsonb("parts").$type<PartLine[]>().notNull().default([]),
  score: real("score"),
  notes: text("notes"),
  filmedBy: text("filmed_by").references(() => identities.id, { onDelete: "set null" }),
  filmedByOrgId: text("filmed_by_org_id").references(() => organizations.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const stageGrades = buildSchema.table("stage_grades", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  recordId: text("record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  stage: text("stage").$type<StageId>().notNull(),
  score: real("score").notNull(),
  grade: text("grade").$type<"A" | "B" | "C" | "D" | "F">().notNull(),
  captureScore: real("capture_score"),
  geometryScore: real("geometry_score"),
  workmanshipScore: real("workmanship_score"),
  complianceScore: real("compliance_score"),
  visionStatus: text("vision_status").$type<"graded" | "unavailable" | "stage_not_shown">(),
  checkpointsPassed: integer("checkpoints_passed").notNull().default(0),
  checkpointsAssessed: integer("checkpoints_assessed").notNull().default(0),
  checkpointsApplicable: integer("checkpoints_applicable").notNull().default(0),
  simulated: boolean("simulated").notNull().default(false),
  filmedAt: ts("filmed_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const checkpointResults = buildSchema.table("checkpoint_results", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  stage: text("stage").$type<StageId>().notNull(),
  qcId: text("qc_id").notNull(),
  num: integer("num").notNull(),
  title: text("title").notNull(),
  category: text("category").$type<"structure" | "envelope" | "mechanical" | "surfaces" | "moisture" | "safety" | "capture">().notNull(),
  status: text("status").$type<"pass" | "attention" | "fail" | "not_assessable">().notNull(),
  source: text("source").$type<"geometry" | "capture" | "vision">().notNull(),
  evidence: text("evidence").notNull(),
  keyframeIndex: integer("keyframe_index"),
});

export const findings = buildSchema.table("findings", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  stage: text("stage").$type<StageId>().notNull(),
  severity: text("severity").$type<"info" | "minor" | "major" | "critical">().notNull(),
  dimension: text("dimension").$type<"capture" | "geometry" | "workmanship" | "compliance">().notNull(),
  source: text("source").$type<"geometry" | "vision" | "capture">().notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  keyframeIndex: integer("keyframe_index"),
  resolvedAt: ts("resolved_at"),
  resolvedBy: text("resolved_by").references(() => identities.id, { onDelete: "set null" }),
});

export const partLines = buildSchema.table("part_lines", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  stage: text("stage").$type<StageId>().notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  spec: text("spec"),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull(),
  basis: text("basis").$type<"measured" | "detected" | "derived">().notNull(),
  derivation: text("derivation").notNull(),
  confidence: real("confidence").notNull(),
  unitCostCents: integer("unit_cost_cents"),
  identified: jsonb("identified").$type<PartLine["identified"]>(),
});

export const assignments = buildSchema.table("assignments", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
  assigneeIdentityId: text("assignee_identity_id").references(() => identities.id, { onDelete: "cascade" }),
  assigneeOrgId: text("assignee_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  task: text("task").notNull(),
  stage: text("stage").$type<StageId>(),
  status: text("status").$type<"open" | "done">().notNull().default("open"),
  assignedBy: text("assigned_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const hires = buildSchema.table("hires", {
  id: text("id").primaryKey(),
  fromOrgId: text("from_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  toIdentityId: text("to_identity_id").references(() => identities.id, { onDelete: "cascade" }),
  toOrgId: text("to_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  task: text("task").notNull(),
  recordId: text("record_id").references(() => records.id, { onDelete: "set null" }),
  note: text("note"),
  status: text("status").$type<"offered" | "accepted" | "declined" | "completed">().notNull().default("offered"),
  createdBy: text("created_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type BuildRecord = typeof records.$inferSelect;
export type RecordAccess = typeof recordAccess.$inferSelect;
export type Capture = typeof captures.$inferSelect;
export type StageGrade = typeof stageGrades.$inferSelect;
export type CheckpointResultRow = typeof checkpointResults.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type PartLineRow = typeof partLines.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Hire = typeof hires.$inferSelect;
