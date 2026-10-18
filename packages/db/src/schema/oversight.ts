import { bigint, date, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import type { StageId } from "@homefax/core";
import { shareLinks } from "./access";
import { identities } from "./auth";
import { captures, records } from "./build";
import { organizations } from "./org";
import { properties } from "./property";

export const oversightSchema = pgSchema("oversight");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const portfolioHoldings = oversightSchema.table("portfolio_holdings", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  kind: text("kind").$type<"construction" | "mortgage" | "heloc" | "bridge" | "commercial">().notNull(),
  loanRefEnc: text("loan_ref_enc"),
  principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
  rateBps: integer("rate_bps"),
  originatedAt: date("originated_at"),
  maturesAt: date("matures_at"),
  status: text("status").$type<"pipeline" | "active" | "paid_off" | "default" | "sold">().notNull().default("active"),
  notes: text("notes"),
  createdBy: text("created_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const loanDraws = oversightSchema.table("loan_draws", {
  id: text("id").primaryKey(),
  holdingId: text("holding_id").notNull().references(() => portfolioHoldings.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  stage: text("stage").$type<StageId>().notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  status: text("status").$type<"requested" | "verified" | "released" | "held" | "rejected">().notNull().default("requested"),
  basisCaptureId: text("basis_capture_id").references(() => captures.id, { onDelete: "set null" }),
  recommendation: text("recommendation"),
  requestedBy: text("requested_by").references(() => identities.id, { onDelete: "set null" }),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  decidedBy: text("decided_by").references(() => identities.id, { onDelete: "set null" }),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
});

export const policies = oversightSchema.table("policies", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  kind: text("kind").$type<"homeowners" | "builders_risk" | "flood" | "umbrella" | "commercial">().notNull(),
  policyRefEnc: text("policy_ref_enc"),
  coverageCents: bigint("coverage_cents", { mode: "number" }).notNull(),
  premiumCents: bigint("premium_cents", { mode: "number" }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to").notNull(),
  status: text("status").$type<"quoted" | "bound" | "active" | "lapsed" | "cancelled">().notNull().default("quoted"),
  notes: text("notes"),
  createdBy: text("created_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const listings = oversightSchema.table("listings", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  agentIdentityId: text("agent_identity_id").references(() => identities.id, { onDelete: "set null" }),
  listPriceCents: bigint("list_price_cents", { mode: "number" }),
  status: text("status").$type<"draft" | "active" | "pending" | "sold" | "withdrawn">().notNull().default("draft"),
  mlsRef: text("mls_ref"),
  shareLinkId: text("share_link_id").references(() => shareLinks.id, { onDelete: "set null" }),
  listedAt: date("listed_at"),
  closedAt: date("closed_at"),
  soldPriceCents: bigint("sold_price_cents", { mode: "number" }),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const permits = oversightSchema.table("permits", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  municipalityOrgId: text("municipality_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  recordId: text("record_id").references(() => records.id, { onDelete: "set null" }),
  permitNo: text("permit_no").notNull(),
  kind: text("kind").$type<"building" | "electrical" | "plumbing" | "mechanical" | "roofing" | "demolition" | "other">().notNull(),
  status: text("status").$type<"applied" | "issued" | "inspected" | "closed" | "flagged" | "revoked">().notNull().default("applied"),
  appliedAt: date("applied_at"),
  issuedAt: date("issued_at"),
  closedAt: date("closed_at"),
  notes: text("notes"),
  createdBy: text("created_by").references(() => identities.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const inspectionReviews = oversightSchema.table("inspection_reviews", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  municipalityOrgId: text("municipality_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  permitId: text("permit_id").references(() => permits.id, { onDelete: "set null" }),
  reviewerId: text("reviewer_id").references(() => identities.id, { onDelete: "set null" }),
  verdict: text("verdict").$type<"verified" | "flagged" | "site_visit">().notNull(),
  notes: text("notes"),
  at: ts("at").notNull().defaultNow(),
});

export type PortfolioHolding = typeof portfolioHoldings.$inferSelect;
export type LoanDraw = typeof loanDraws.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Permit = typeof permits.$inferSelect;
export type InspectionReview = typeof inspectionReviews.$inferSelect;
