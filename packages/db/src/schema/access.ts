import { bigserial, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { identities } from "./auth";
import { organizations } from "./org";
import { properties, type Scope } from "./property";

export const accessSchema = pgSchema("access");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const grants = accessSchema.table("grants", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  granteeOrgId: text("grantee_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  granteeIdentityId: text("grantee_identity_id").references(() => identities.id, { onDelete: "cascade" }),
  scope: text("scope").$type<Scope>().notNull(),
  purpose: text("purpose"),
  grantedBy: text("granted_by").references(() => identities.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  revokedBy: text("revoked_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const accessRequests = accessSchema.table("access_requests", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  requesterOrgId: text("requester_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  requesterIdentityId: text("requester_identity_id").references(() => identities.id, { onDelete: "set null" }),
  scope: text("scope").$type<Scope>().notNull(),
  purpose: text("purpose").notNull(),
  status: text("status").$type<"pending" | "approved" | "denied" | "withdrawn">().notNull().default("pending"),
  decidedBy: text("decided_by").references(() => identities.id, { onDelete: "set null" }),
  decidedAt: ts("decided_at"),
  grantId: text("grant_id").references(() => grants.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const shareLinks = accessSchema.table("share_links", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  scope: text("scope").$type<Scope>().notNull(),
  label: text("label"),
  createdBy: text("created_by").references(() => identities.id, { onDelete: "set null" }),
  createdByOrgId: text("created_by_org_id").references(() => organizations.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: ts("last_viewed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type AccessVia = "owner" | "project" | "grant" | "jurisdiction" | "share_link" | "service";

export const accessLog = accessSchema.table("access_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  viewerIdentityId: text("viewer_identity_id").references(() => identities.id, { onDelete: "set null" }),
  viewerOrgId: text("viewer_org_id").references(() => organizations.id, { onDelete: "set null" }),
  via: text("via").$type<AccessVia>().notNull(),
  scope: text("scope").$type<Scope>().notNull(),
  app: text("app").notNull(),
  path: text("path"),
  shareLinkId: text("share_link_id").references(() => shareLinks.id, { onDelete: "set null" }),
  at: ts("at").notNull().defaultNow(),
});

export type Grant = typeof grants.$inferSelect;
export type AccessRequest = typeof accessRequests.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type AccessLogRow = typeof accessLog.$inferSelect;
