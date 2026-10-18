import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { hashToken, mintHfxKey, mintToken } from "@homefax/auth";
import type { Tx } from "../client";
import { newId, slugify } from "../ids";
import { identities } from "../schema/auth";
import {
  invitations,
  jurisdictions,
  memberships,
  organizations,
  type Invitation,
  type Jurisdiction,
  type MemberRole,
  type Membership,
  type Organization,
  type OrgKind,
} from "../schema/org";
import { profiles, type Profile } from "../schema/people";
import { toPublicProfile, type PublicProfile } from "./people";

export type Member = { membership: Membership; profile: PublicProfile; email?: string };
export type OrgWithRole = Organization & { role: MemberRole };

/** What an org shows to people outside it. */
export type PublicOrg = Pick<Organization, "id" | "kind" | "name" | "slug" | "headline" | "bio" | "isPublic" | "createdAt">;
export function toPublicOrg(o: Organization): PublicOrg {
  return { id: o.id, kind: o.kind, name: o.name, slug: o.slug, headline: o.headline, bio: o.bio, isPublic: o.isPublic, createdAt: o.createdAt };
}

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  contractor: "Contractor",
  lender: "Lender",
  insurer: "Insurer",
  municipality: "Municipality",
  brokerage: "Brokerage",
  inspector: "Inspector",
};

async function uniqueSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name, 48);
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const clash = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!clash.length) return slug;
    slug = `${base.slice(0, 43)}-${newId().slice(0, 4).toLowerCase()}`;
  }
  throw new Error("Could not find a free slug");
}

/** Create an organisation and make `ownerIdentityId` its owner. Works as actor or service. */
export async function createOrg(
  tx: Tx,
  input: { kind: OrgKind; name: string; headline?: string | null; bio?: string | null; ownerIdentityId: string; isPublic?: boolean; legacyKeyId?: string | null },
): Promise<Organization> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Give the organisation a name");
  const [org] = await tx
    .insert(organizations)
    .values({
      id: newId(),
      kind: input.kind,
      name,
      slug: await uniqueSlug(tx, name),
      headline: input.headline?.trim() || null,
      bio: input.bio?.trim() || null,
      isPublic: input.isPublic ?? false,
      hfxKey: mintHfxKey(),
      ownerIdentityId: input.ownerIdentityId,
      legacyKeyId: input.legacyKeyId ?? null,
    })
    .returning();
  await tx.insert(memberships).values({ id: newId(), orgId: org.id, identityId: input.ownerIdentityId, role: "owner" });
  return org;
}

export async function getOrg(tx: Tx, id: string): Promise<Organization | null> {
  return (await tx.select().from(organizations).where(eq(organizations.id, id)).limit(1))[0] ?? null;
}
export async function getOrgBySlug(tx: Tx, slug: string): Promise<Organization | null> {
  return (await tx.select().from(organizations).where(eq(organizations.slug, slug)).limit(1))[0] ?? null;
}
export async function getOrgByHfxKey(tx: Tx, hfxKey: string): Promise<Organization | null> {
  // Keys are only resolvable by the service: an actor cannot enumerate orgs by key.
  return (await tx.select().from(organizations).where(eq(organizations.hfxKey, hfxKey.trim())).limit(1))[0] ?? null;
}

export async function updateOrg(
  tx: Tx,
  id: string,
  patch: Partial<Pick<Organization, "name" | "headline" | "bio" | "isPublic">>,
): Promise<Organization> {
  const set: Partial<Organization> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (n.length < 2) throw new Error("Give the organisation a name");
    set.name = n;
  }
  if (patch.headline !== undefined) set.headline = patch.headline?.trim() || null;
  if (patch.bio !== undefined) set.bio = patch.bio?.trim() || null;
  if (patch.isPublic !== undefined) set.isPublic = patch.isPublic;
  const [row] = await tx.update(organizations).set(set).where(eq(organizations.id, id)).returning();
  if (!row) throw new Error("Organisation not found or not yours to edit");
  return row;
}

export async function regenerateHfxKey(tx: Tx, id: string): Promise<string> {
  const key = mintHfxKey();
  const [row] = await tx.update(organizations).set({ hfxKey: key }).where(eq(organizations.id, id)).returning({ id: organizations.id });
  if (!row) throw new Error("Organisation not found or not yours to edit");
  return key;
}

export async function listOrgsForIdentity(tx: Tx, identityId: string): Promise<OrgWithRole[]> {
  const rows = await tx
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.identityId, identityId))
    .orderBy(organizations.createdAt);
  return rows.map((r) => ({ ...r.org, role: r.role }));
}

export async function getMembership(tx: Tx, orgId: string, identityId: string): Promise<Membership | null> {
  return (await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.identityId, identityId))).limit(1))[0] ?? null;
}
export async function getMembershipById(tx: Tx, id: string): Promise<Membership | null> {
  return (await tx.select().from(memberships).where(eq(memberships.id, id)).limit(1))[0] ?? null;
}

export async function listMembers(tx: Tx, orgId: string): Promise<Member[]> {
  const rows = await tx
    .select({ membership: memberships, profile: profiles })
    .from(memberships)
    .innerJoin(profiles, eq(profiles.identityId, memberships.identityId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(memberships.createdAt);
  return rows.map((r) => ({ membership: r.membership, profile: toPublicProfile(r.profile) }));
}

export async function addMember(
  tx: Tx,
  input: { orgId: string; identityId: string; role?: Exclude<MemberRole, "owner">; title?: string | null },
): Promise<Membership> {
  const existing = await getMembership(tx, input.orgId, input.identityId);
  if (existing) throw new Error("Already a member");
  const [row] = await tx
    .insert(memberships)
    .values({ id: newId(), orgId: input.orgId, identityId: input.identityId, role: input.role ?? "member", title: input.title?.trim() || null })
    .returning();
  return row;
}

/**
 * Add by email or handle. Runs the lookup as the service (actors cannot read
 * other identities) but the insert as the actor, so the admin policy applies.
 */
export async function findIdentityIdByEmailOrHandle(tx: Tx, needle: string): Promise<string | null> {
  const n = needle.trim().toLowerCase();
  if (n.includes("@")) {
    const r = (await tx.select({ id: identities.id }).from(identities).where(eq(identities.email, n)).limit(1))[0];
    return r?.id ?? null;
  }
  const r = (await tx.select({ id: profiles.identityId }).from(profiles).where(eq(profiles.handle, n.replace(/^@/, ""))).limit(1))[0];
  return r?.id ?? null;
}

export async function updateMember(tx: Tx, membershipId: string, patch: { role?: Exclude<MemberRole, "owner">; title?: string | null }): Promise<Membership> {
  const set: Partial<Membership> = {};
  if (patch.role) set.role = patch.role;
  if (patch.title !== undefined) set.title = patch.title?.trim() || null;
  const [row] = await tx.update(memberships).set(set).where(and(eq(memberships.id, membershipId))).returning();
  if (!row) throw new Error("Membership not found");
  return row;
}

export async function removeMember(tx: Tx, membershipId: string): Promise<void> {
  const m = await getMembershipById(tx, membershipId);
  if (!m) return;
  if (m.role === "owner") throw new Error("The owner cannot be removed — transfer ownership first");
  await tx.delete(memberships).where(eq(memberships.id, membershipId));
}

export async function transferOwnership(tx: Tx, orgId: string, toIdentityId: string): Promise<void> {
  const org = await getOrg(tx, orgId);
  if (!org) throw new Error("Organisation not found");
  const target = await getMembership(tx, orgId, toIdentityId);
  if (!target) throw new Error("The new owner must already be a member");
  await tx.update(memberships).set({ role: "admin" }).where(and(eq(memberships.orgId, orgId), eq(memberships.identityId, org.ownerIdentityId)));
  await tx.update(memberships).set({ role: "owner" }).where(eq(memberships.id, target.id));
  await tx.update(organizations).set({ ownerIdentityId: toIdentityId }).where(eq(organizations.id, orgId));
}

/* ------------------------------ invitations ----------------------------- */

export const INVITATION_DAYS = 7;

export async function createInvitation(
  tx: Tx,
  input: { orgId: string; email?: string | null; role?: "admin" | "member"; title?: string | null; invitedBy: string },
): Promise<{ invitation: Invitation; token: string }> {
  const { token, tokenHash } = mintToken(24);
  const [invitation] = await tx
    .insert(invitations)
    .values({
      id: newId(),
      orgId: input.orgId,
      email: input.email?.trim().toLowerCase() || null,
      role: input.role ?? "member",
      title: input.title?.trim() || null,
      tokenHash,
      invitedBy: input.invitedBy,
      expiresAt: new Date(Date.now() + INVITATION_DAYS * 86400_000),
    })
    .returning();
  return { invitation, token };
}

export async function listInvitations(tx: Tx, orgId: string): Promise<Invitation[]> {
  return tx
    .select()
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(desc(invitations.createdAt));
}

export async function revokeInvitation(tx: Tx, id: string): Promise<void> {
  await tx.delete(invitations).where(eq(invitations.id, id));
}

/** Service: look an invitation up by its token (actors cannot read invitations of orgs they are not in). */
export async function findInvitation(tx: Tx, token: string): Promise<{ invitation: Invitation; org: Organization } | null> {
  const rows = await tx
    .select({ invitation: invitations, org: organizations })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

/** Service: accept. Creates the membership and marks the invitation used. */
export async function acceptInvitation(tx: Tx, token: string, identityId: string): Promise<Organization> {
  const found = await findInvitation(tx, token);
  if (!found) throw new Error("This invitation is not valid or has expired");
  if (!(await getMembership(tx, found.org.id, identityId))) {
    await tx.insert(memberships).values({ id: newId(), orgId: found.org.id, identityId, role: found.invitation.role, title: found.invitation.title });
  }
  await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: identityId }).where(eq(invitations.id, found.invitation.id));
  return found.org;
}

/* ------------------------------ jurisdictions --------------------------- */

export async function listJurisdictions(tx: Tx, orgId: string): Promise<Jurisdiction[]> {
  return tx.select().from(jurisdictions).where(eq(jurisdictions.orgId, orgId)).orderBy(jurisdictions.state, jurisdictions.city);
}

export async function addJurisdiction(
  tx: Tx,
  input: { orgId: string; state: string; city?: string | null; county?: string | null; postalCode?: string | null },
): Promise<Jurisdiction> {
  const state = input.state.trim().toUpperCase();
  if (state.length !== 2) throw new Error("State must be the two-letter code");
  if (!input.city?.trim() && !input.county?.trim() && !input.postalCode?.trim()) throw new Error("Name a city, county, or ZIP code");
  const [row] = await tx
    .insert(jurisdictions)
    .values({ id: newId(), orgId: input.orgId, state, city: input.city?.trim() || null, county: input.county?.trim() || null, postalCode: input.postalCode?.trim() || null })
    .returning();
  return row;
}

export async function removeJurisdiction(tx: Tx, id: string): Promise<void> {
  await tx.delete(jurisdictions).where(eq(jurisdictions.id, id));
}

/* ------------------------------- directory ------------------------------ */

export async function listPublicOrgs(tx: Tx, kinds?: OrgKind[]): Promise<PublicOrg[]> {
  const rows = await tx
    .select()
    .from(organizations)
    .where(kinds?.length ? and(eq(organizations.isPublic, true), inArray(organizations.kind, kinds)) : eq(organizations.isPublic, true))
    .orderBy(organizations.name);
  return rows.map(toPublicOrg);
}

export async function getOrgsByIds(tx: Tx, ids: string[]): Promise<Map<string, Organization>> {
  if (!ids.length) return new Map();
  const rows = await tx.select().from(organizations).where(inArray(organizations.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getProfilesByIds(tx: Tx, ids: string[]): Promise<Map<string, Profile>> {
  if (!ids.length) return new Map();
  const rows = await tx.select().from(profiles).where(inArray(profiles.identityId, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.identityId, r]));
}

/** Municipalities whose jurisdiction covers an address. Public read (jurisdictions are statutory, organisations of kind municipality are public). */
export async function municipalitiesCovering(
  tx: Tx,
  property: { state: string; city: string; county: string | null; postalCode: string },
): Promise<PublicOrg[]> {
  const { sql: s } = await import("drizzle-orm");
  const rows = await tx
    .selectDistinct({ org: organizations })
    .from(jurisdictions)
    .innerJoin(organizations, and(eq(organizations.id, jurisdictions.orgId), eq(organizations.kind, "municipality")))
    .where(
      and(
        eq(jurisdictions.state, property.state),
        s`(
          (${jurisdictions.city} IS NOT NULL AND upper(${jurisdictions.city}) = upper(${property.city}))
          OR (${jurisdictions.county} IS NOT NULL AND ${property.county ?? null}::text IS NOT NULL AND upper(${jurisdictions.county}) = upper(${property.county ?? null}::text))
          OR (${jurisdictions.postalCode} IS NOT NULL AND ${jurisdictions.postalCode} = ${property.postalCode})
        )`,
      ),
    );
  return rows.map((r) => toPublicOrg(r.org));
}
