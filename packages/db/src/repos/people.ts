import { and, eq } from "drizzle-orm";
import { decryptField, encryptField } from "@homefax/auth";
import type { Tx } from "../client";
import { profiles, type Profile } from "../schema/people";

/** A profile stripped of anything that is not for strangers. */
export type PublicProfile = Pick<Profile, "identityId" | "name" | "handle" | "headline" | "bio" | "avatarUrl" | "createdAt">;

export function toPublicProfile(p: Profile): PublicProfile {
  return { identityId: p.identityId, name: p.name, handle: p.handle, headline: p.headline, bio: p.bio, avatarUrl: p.avatarUrl, createdAt: p.createdAt };
}

export async function getProfile(tx: Tx, identityId: string): Promise<Profile | null> {
  return (await tx.select().from(profiles).where(eq(profiles.identityId, identityId)).limit(1))[0] ?? null;
}

export async function getProfileByHandle(tx: Tx, handle: string): Promise<Profile | null> {
  return (await tx.select().from(profiles).where(eq(profiles.handle, handle.toLowerCase().trim())).limit(1))[0] ?? null;
}

export async function updateProfile(
  tx: Tx,
  identityId: string,
  patch: Partial<Pick<Profile, "name" | "handle" | "headline" | "bio" | "avatarUrl" | "isPublic">> & { phone?: string | null },
): Promise<Profile> {
  const set: Partial<Profile> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("Name is required");
    set.name = n;
  }
  if (patch.handle !== undefined) {
    const h = patch.handle.toLowerCase().trim();
    if (!/^[a-z0-9-]{3,24}$/.test(h)) throw new Error("Handle must be 3–24 lowercase letters, numbers, or hyphens");
    const clash = await tx.select({ id: profiles.identityId }).from(profiles).where(eq(profiles.handle, h)).limit(1);
    if (clash[0] && clash[0].id !== identityId) throw new Error("That handle is taken");
    set.handle = h;
  }
  if (patch.headline !== undefined) set.headline = patch.headline?.trim() || null;
  if (patch.bio !== undefined) set.bio = patch.bio?.trim() || null;
  if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl || null;
  if (patch.isPublic !== undefined) set.isPublic = patch.isPublic;
  if (patch.phone !== undefined) set.phoneEnc = patch.phone?.trim() ? encryptField(patch.phone.trim()) : null;
  const [row] = await tx.update(profiles).set(set).where(eq(profiles.identityId, identityId)).returning();
  if (!row) throw new Error("Profile not found");
  return row;
}

export function phoneOf(p: Profile): string | null {
  if (!p.phoneEnc) return null;
  try {
    return decryptField(p.phoneEnc);
  } catch {
    return null;
  }
}

export async function listPublicProfiles(tx: Tx): Promise<PublicProfile[]> {
  const rows = await tx.select().from(profiles).where(and(eq(profiles.isPublic, true)));
  return rows.map(toPublicProfile);
}
