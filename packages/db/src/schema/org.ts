import { boolean, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { identities } from "./auth";

export const orgSchema = pgSchema("org");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type OrgKind = "contractor" | "lender" | "insurer" | "municipality" | "brokerage" | "inspector";
export type MemberRole = "owner" | "admin" | "member";

export const organizations = orgSchema.table("organizations", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<OrgKind>().notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  headline: text("headline"),
  bio: text("bio"),
  isPublic: boolean("is_public").notNull().default(false),
  hfxKey: text("hfx_key").notNull(),
  ownerIdentityId: text("owner_identity_id").notNull().references(() => identities.id),
  legacyKeyId: text("legacy_key_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const memberships = orgSchema.table("memberships", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  identityId: text("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
  role: text("role").$type<MemberRole>().notNull().default("member"),
  title: text("title"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const invitations = orgSchema.table("invitations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email"),
  role: text("role").$type<"admin" | "member">().notNull().default("member"),
  title: text("title"),
  tokenHash: text("token_hash").notNull(),
  invitedBy: text("invited_by").references(() => identities.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  acceptedBy: text("accepted_by").references(() => identities.id, { onDelete: "set null" }),
  acceptedAt: ts("accepted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const jurisdictions = orgSchema.table("jurisdictions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  city: text("city"),
  county: text("county"),
  postalCode: text("postal_code"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type Jurisdiction = typeof jurisdictions.$inferSelect;
