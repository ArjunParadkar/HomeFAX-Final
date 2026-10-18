import { bigserial, boolean, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const auditSchema = pgSchema("audit");

export const auditLog = auditSchema.table("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorId: text("actor_id"),
  isService: boolean("is_service").notNull().default(false),
  action: text("action").$type<"INSERT" | "UPDATE" | "DELETE">().notNull(),
  schemaName: text("schema_name").notNull(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id"),
  propertyId: text("property_id"),
  orgId: text("org_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
});

export type AuditRow = typeof auditLog.$inferSelect;
