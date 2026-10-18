import { sql } from "drizzle-orm";
import { bigint, doublePrecision, integer, numeric, pgSchema, real, text, timestamp } from "drizzle-orm/pg-core";
import { identities } from "./auth";
import { organizations } from "./org";

export const propertySchema = pgSchema("property");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type PropertyKind = "single_family" | "multi_family" | "condo" | "townhome" | "commercial" | "other";
export type Scope = "summary" | "ledger" | "full";
export type PropertyEventKind =
  | "record_opened" | "stage_filmed" | "stage_graded" | "stage_failed" | "owner_claimed" | "owner_transferred"
  | "access_granted" | "access_revoked" | "access_requested" | "share_link_created" | "document_added"
  | "permit_issued" | "inspection_verdict" | "draw_decided" | "policy_bound" | "listing_changed" | "note";

export const properties = propertySchema.table("properties", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  county: text("county"),
  country: text("country").notNull().default("US"),
  /** STORED generated column (see 0001_platform.sql). Never written by the app. */
  addressKey: text("address_key").generatedAlwaysAs(sql`lower(regexp_replace(line1 || coalesce(line2,'') || city || state || postal_code, '[^A-Za-z0-9]', '', 'g'))`),
  parcelId: text("parcel_id"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  kind: text("kind").$type<PropertyKind>().notNull().default("single_family"),
  yearBuilt: integer("year_built"),
  floorAreaSqft: integer("floor_area_sqft"),
  lotAreaSqft: integer("lot_area_sqft"),
  bedrooms: integer("bedrooms"),
  bathrooms: numeric("bathrooms", { precision: 3, scale: 1 }),
  createdBy: text("created_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const propertyOwners = propertySchema.table("property_owners", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  identityId: text("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
  role: text("role").$type<"owner" | "co_owner" | "tenant">().notNull().default("owner"),
  claimedVia: text("claimed_via").$type<"invite" | "contractor" | "transfer" | "import" | "seed">().notNull(),
  since: ts("since").notNull().defaultNow(),
  until: ts("until"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const ownerInvites = propertySchema.table("owner_invites", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  email: text("email"),
  invitedBy: text("invited_by").references(() => identities.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  claimedBy: text("claimed_by").references(() => identities.id, { onDelete: "set null" }),
  claimedAt: ts("claimed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const propertyStats = propertySchema.table("property_stats", {
  propertyId: text("property_id").primaryKey().references(() => properties.id, { onDelete: "cascade" }),
  stagesTotal: integer("stages_total").notNull().default(11),
  stagesFilmed: integer("stages_filmed").notNull().default(0),
  stagesInFlight: integer("stages_in_flight").notNull().default(0),
  pointsPassed: integer("points_passed").notNull().default(0),
  pointsAssessed: integer("points_assessed").notNull().default(0),
  pointsFailed: integer("points_failed").notNull().default(0),
  openSafetyItems: integer("open_safety_items").notNull().default(0),
  openMoistureItems: integer("open_moisture_items").notNull().default(0),
  criticalFindings: integer("critical_findings").notNull().default(0),
  majorFindings: integer("major_findings").notNull().default(0),
  latestScore: real("latest_score"),
  latestGrade: text("latest_grade").$type<"A" | "B" | "C" | "D" | "F">(),
  meanScore: real("mean_score"),
  latestStage: text("latest_stage"),
  materialsLines: integer("materials_lines").notNull().default(0),
  materialsTotalCents: bigint("materials_total_cents", { mode: "number" }).notNull().default(0),
  measuredFloorAreaM2: real("measured_floor_area_m2"),
  lastCaptureAt: ts("last_capture_at"),
  verifiedStages: integer("verified_stages").notNull().default(0),
  flaggedStages: integer("flagged_stages").notNull().default(0),
  recomputedAt: ts("recomputed_at").notNull().defaultNow(),
});

export const propertyEvents = propertySchema.table("property_events", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  kind: text("kind").$type<PropertyEventKind>().notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  stage: text("stage"),
  actorId: text("actor_id").references(() => identities.id, { onDelete: "set null" }),
  actorOrgId: text("actor_org_id").references(() => organizations.id, { onDelete: "set null" }),
  visibility: text("visibility").$type<Scope>().notNull().default("full"),
  at: ts("at").notNull().defaultNow(),
});

export const propertyDocuments = propertySchema.table("property_documents", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"permit" | "plan" | "warranty" | "invoice" | "inspection" | "insurance" | "deed" | "manual" | "photo" | "other">().notNull(),
  title: text("title").notNull(),
  blobUrl: text("blob_url").notNull(),
  contentType: text("content_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  uploadedBy: text("uploaded_by").references(() => identities.id, { onDelete: "set null" }),
  uploadedByOrgId: text("uploaded_by_org_id").references(() => organizations.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Property = typeof properties.$inferSelect;
export type PropertyOwner = typeof propertyOwners.$inferSelect;
export type OwnerInvite = typeof ownerInvites.$inferSelect;
export type PropertyStats = typeof propertyStats.$inferSelect;
export type PropertyEvent = typeof propertyEvents.$inferSelect;
export type PropertyDocument = typeof propertyDocuments.$inferSelect;
