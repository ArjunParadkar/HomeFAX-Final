import { boolean, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { identities } from "./auth";

export const peopleSchema = pgSchema("people");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const profiles = peopleSchema.table("profiles", {
  identityId: text("identity_id").primaryKey().references(() => identities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  handle: text("handle").notNull(),
  headline: text("headline"),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  /** AES-256-GCM via @homefax/auth encryptField. */
  phoneEnc: text("phone_enc"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;
