import {
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

export const records = homefax.table(
  "records",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    address: text("address").notNull(),
    owner: text("owner"),
    contractor: text("contractor"),
    /** Which access key created it — the tenant boundary. */
    keyId: text("key_id").notNull(),
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
