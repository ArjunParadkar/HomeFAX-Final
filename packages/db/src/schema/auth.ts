import { bigserial, boolean, inet, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const identities = authSchema.table("identities", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  status: text("status").$type<"active" | "suspended" | "deleted">().notNull().default("active"),
  lastSignInAt: ts("last_sign_in_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const credentials = authSchema.table("credentials", {
  identityId: text("identity_id").primaryKey().references(() => identities.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  mustChange: boolean("must_change").notNull().default(false),
  rotatedAt: ts("rotated_at").notNull().defaultNow(),
});

export const sessions = authSchema.table("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  identityId: text("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
  app: text("app").$type<"contractor" | "homeowner" | "admin">().notNull(),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
});

export const loginAttempts = authSchema.table("login_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  email: text("email").notNull(),
  ip: inet("ip"),
  succeeded: boolean("succeeded").notNull(),
  app: text("app").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const passwordResets = authSchema.table("password_resets", {
  id: text("id").primaryKey(),
  identityId: text("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  issuedBy: text("issued_by").references(() => identities.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Identity = typeof identities.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;
