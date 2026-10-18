import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { hashToken, mintClaimCode, normalizeClaimCode } from "@homefax/auth";
import { addressKey, normalizeAddress, type AddressParts } from "../address";
import type { Tx } from "../client";
import { newId, slugify } from "../ids";
import { profiles } from "../schema/people";
import {
  ownerInvites,
  properties,
  propertyDocuments,
  propertyEvents,
  propertyOwners,
  propertyStats,
  type OwnerInvite,
  type Property,
  type PropertyDocument,
  type PropertyEvent,
  type PropertyEventKind,
  type PropertyOwner,
  type PropertyStats,
  type Scope,
} from "../schema/property";
import { toPublicProfile, type PublicProfile } from "./people";

export type PropertyWithStats = { property: Property; stats: PropertyStats };

async function uniquePropertySlug(tx: Tx, parts: AddressParts): Promise<string> {
  const base = slugify(`${parts.line1} ${parts.city}`, 70);
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const clash = await tx.select({ id: properties.id }).from(properties).where(eq(properties.slug, slug)).limit(1);
    if (!clash.length) return slug;
    slug = `${base.slice(0, 64)}-${newId().slice(0, 4).toLowerCase()}`;
  }
  throw new Error("Could not find a free slug");
}

/**
 * The one way a property comes into being. Looks the address up by its
 * normalised key first so two contractors (or a contractor and a homeowner)
 * typing the same house land on the same row.
 *
 * Must run as the SERVICE: an actor cannot see a property they do not yet
 * have a relationship with, so the dedup lookup would miss it.
 */
export async function findOrCreateProperty(
  tx: Tx,
  input: AddressParts & { createdBy?: string | null; kind?: Property["kind"]; yearBuilt?: number | null },
): Promise<{ property: Property; created: boolean }> {
  const parts = normalizeAddress(input);
  const key = addressKey(parts);
  const existing = (await tx.select().from(properties).where(eq(properties.addressKey, key)).limit(1))[0];
  if (existing) return { property: existing, created: false };
  const [property] = await tx
    .insert(properties)
    .values({
      id: newId(),
      slug: await uniquePropertySlug(tx, parts),
      line1: parts.line1,
      line2: parts.line2,
      city: parts.city,
      state: parts.state,
      postalCode: parts.postalCode,
      county: parts.county,
      country: parts.country,
      kind: input.kind ?? "single_family",
      yearBuilt: input.yearBuilt ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return { property, created: true };
}

export async function getProperty(tx: Tx, id: string): Promise<Property | null> {
  return (await tx.select().from(properties).where(eq(properties.id, id)).limit(1))[0] ?? null;
}
export async function getPropertyBySlug(tx: Tx, slug: string): Promise<Property | null> {
  return (await tx.select().from(properties).where(eq(properties.slug, slug)).limit(1))[0] ?? null;
}

export async function getPropertyWithStats(tx: Tx, id: string): Promise<PropertyWithStats | null> {
  const rows = await tx
    .select({ property: properties, stats: propertyStats })
    .from(properties)
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(eq(properties.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPropertiesWithStats(tx: Tx, ids: string[]): Promise<PropertyWithStats[]> {
  if (!ids.length) return [];
  return tx
    .select({ property: properties, stats: propertyStats })
    .from(properties)
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(inArray(properties.id, [...new Set(ids)]));
}

export async function updateProperty(
  tx: Tx,
  id: string,
  patch: Partial<Pick<Property, "kind" | "yearBuilt" | "floorAreaSqft" | "lotAreaSqft" | "bedrooms" | "bathrooms" | "parcelId" | "county" | "lat" | "lng">>,
): Promise<Property> {
  const [row] = await tx.update(properties).set(patch).where(eq(properties.id, id)).returning();
  if (!row) throw new Error("Property not found or not yours to edit");
  return row;
}

/** Everything the actor can see that matches. RLS does the filtering; this does the matching. */
export async function searchProperties(tx: Tx, q: string, limit = 25): Promise<PropertyWithStats[]> {
  const needle = `%${q.trim()}%`;
  return tx
    .select({ property: properties, stats: propertyStats })
    .from(properties)
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(or(ilike(properties.line1, needle), ilike(properties.city, needle), ilike(properties.postalCode, needle), ilike(properties.slug, needle)))
    .orderBy(desc(propertyStats.lastCaptureAt), properties.line1)
    .limit(limit);
}

/* -------------------------------- owners -------------------------------- */

export type OwnerRow = { owner: PropertyOwner; profile: PublicProfile };

export async function listOwners(tx: Tx, propertyId: string, includePast = false): Promise<OwnerRow[]> {
  const rows = await tx
    .select({ owner: propertyOwners, profile: profiles })
    .from(propertyOwners)
    .innerJoin(profiles, eq(profiles.identityId, propertyOwners.identityId))
    .where(includePast ? eq(propertyOwners.propertyId, propertyId) : and(eq(propertyOwners.propertyId, propertyId), isNull(propertyOwners.until)))
    .orderBy(propertyOwners.since);
  return rows.map((r) => ({ owner: r.owner, profile: toPublicProfile(r.profile) }));
}

export async function listPropertiesForOwner(tx: Tx, identityId: string): Promise<PropertyWithStats[]> {
  return tx
    .select({ property: properties, stats: propertyStats })
    .from(propertyOwners)
    .innerJoin(properties, eq(properties.id, propertyOwners.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(and(eq(propertyOwners.identityId, identityId), isNull(propertyOwners.until)))
    .orderBy(desc(propertyOwners.since));
}

export const OWNER_INVITE_DAYS = 30;

/** A contractor (or current owner) issues a claim code for the homeowner. */
export async function createOwnerInvite(
  tx: Tx,
  input: { propertyId: string; invitedBy: string | null; email?: string | null },
): Promise<{ invite: OwnerInvite; code: string }> {
  const code = mintClaimCode();
  const [invite] = await tx
    .insert(ownerInvites)
    .values({
      id: newId(),
      propertyId: input.propertyId,
      codeHash: hashToken(code),
      email: input.email?.trim().toLowerCase() || null,
      invitedBy: input.invitedBy || null,
      expiresAt: new Date(Date.now() + OWNER_INVITE_DAYS * 86400_000),
    })
    .returning();
  return { invite, code };
}

export async function listOwnerInvites(tx: Tx, propertyId: string): Promise<OwnerInvite[]> {
  return tx
    .select()
    .from(ownerInvites)
    .where(and(eq(ownerInvites.propertyId, propertyId), isNull(ownerInvites.claimedAt), gt(ownerInvites.expiresAt, new Date())))
    .orderBy(desc(ownerInvites.createdAt));
}

/** Service: the homeowner types the code. Makes them the current owner. */
export async function claimProperty(tx: Tx, code: string, identityId: string): Promise<Property> {
  const normalized = normalizeClaimCode(code);
  const invite = (
    await tx
      .select()
      .from(ownerInvites)
      .where(and(eq(ownerInvites.codeHash, hashToken(normalized)), isNull(ownerInvites.claimedAt), gt(ownerInvites.expiresAt, new Date())))
      .limit(1)
  )[0];
  if (!invite) throw new Error("That claim code is not valid or has expired");
  const property = await getProperty(tx, invite.propertyId);
  if (!property) throw new Error("Property not found");
  const already = (
    await tx.select().from(propertyOwners).where(and(eq(propertyOwners.propertyId, property.id), eq(propertyOwners.identityId, identityId), isNull(propertyOwners.until))).limit(1)
  )[0];
  if (!already) {
    await tx.insert(propertyOwners).values({ id: newId(), propertyId: property.id, identityId, role: "owner", claimedVia: "invite" });
  }
  await tx.update(ownerInvites).set({ claimedAt: new Date(), claimedBy: identityId }).where(eq(ownerInvites.id, invite.id));
  const name = (await tx.select({ name: profiles.name }).from(profiles).where(eq(profiles.identityId, identityId)).limit(1))[0]?.name ?? "The homeowner";
  await addEvent(tx, { propertyId: property.id, kind: "owner_claimed", title: `${name} claimed the record`, actorId: identityId, visibility: "ledger" });
  return property;
}

/** Owner → new owner. Ends the current period and opens the next. */
export async function transferOwnership(tx: Tx, propertyId: string, fromIdentityId: string, toIdentityId: string): Promise<void> {
  const now = new Date();
  await tx
    .update(propertyOwners)
    .set({ until: now })
    .where(and(eq(propertyOwners.propertyId, propertyId), eq(propertyOwners.identityId, fromIdentityId), isNull(propertyOwners.until)));
  await tx.insert(propertyOwners).values({ id: newId(), propertyId, identityId: toIdentityId, role: "owner", claimedVia: "transfer", since: now });
  await addEvent(tx, { propertyId, kind: "owner_transferred", title: "Ownership transferred", actorId: fromIdentityId, visibility: "ledger" });
}

/* -------------------------------- stats --------------------------------- */

export async function getStats(tx: Tx, propertyId: string): Promise<PropertyStats | null> {
  return (await tx.select().from(propertyStats).where(eq(propertyStats.propertyId, propertyId)).limit(1))[0] ?? null;
}

export async function recomputeStats(tx: Tx, propertyId: string): Promise<void> {
  await tx.execute(sql`SELECT property.recompute_stats(${propertyId})`);
}

/* -------------------------------- events -------------------------------- */

export async function addEvent(
  tx: Tx,
  input: { propertyId: string; kind: PropertyEventKind; title: string; detail?: string | null; stage?: string | null; actorId?: string | null; actorOrgId?: string | null; visibility?: Scope },
): Promise<PropertyEvent> {
  // No RETURNING: the writer may hold less scope than the event's visibility
  // (a lender deciding a draw, a requester asking for access), and RETURNING
  // would re-check the SELECT policy against them.
  const row: PropertyEvent = {
    id: newId(),
    propertyId: input.propertyId,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? null,
    stage: input.stage ?? null,
    actorId: input.actorId ?? null,
    actorOrgId: input.actorOrgId ?? null,
    visibility: input.visibility ?? "full",
    at: new Date(),
  };
  await tx.insert(propertyEvents).values(row);
  return row;
}

export async function listEvents(tx: Tx, propertyId: string, limit = 50): Promise<PropertyEvent[]> {
  return tx.select().from(propertyEvents).where(eq(propertyEvents.propertyId, propertyId)).orderBy(desc(propertyEvents.at)).limit(limit);
}

/* ------------------------------ documents ------------------------------- */

export async function listDocuments(tx: Tx, propertyId: string): Promise<PropertyDocument[]> {
  return tx.select().from(propertyDocuments).where(eq(propertyDocuments.propertyId, propertyId)).orderBy(desc(propertyDocuments.createdAt));
}

export async function addDocument(
  tx: Tx,
  input: { propertyId: string; kind: PropertyDocument["kind"]; title: string; blobUrl: string; contentType?: string | null; sizeBytes?: number | null; uploadedBy: string; uploadedByOrgId?: string | null },
): Promise<PropertyDocument> {
  const title = input.title.trim();
  if (!title) throw new Error("Give the document a title");
  const [row] = await tx
    .insert(propertyDocuments)
    .values({ id: newId(), ...input, title, contentType: input.contentType ?? null, sizeBytes: input.sizeBytes ?? null, uploadedByOrgId: input.uploadedByOrgId ?? null })
    .returning();
  await addEvent(tx, { propertyId: input.propertyId, kind: "document_added", title: `Added ${title}`, actorId: input.uploadedBy, actorOrgId: input.uploadedByOrgId ?? null });
  return row;
}

export async function removeDocument(tx: Tx, id: string): Promise<void> {
  await tx.delete(propertyDocuments).where(eq(propertyDocuments.id, id));
}

/**
 * Service: look a house up by address without creating it — for an institution
 * that wants to request access to a house it cannot yet see. Returns only what
 * the request form needs; the caller must not leak stats from this.
 */
export async function findByAddress(tx: Tx, input: AddressParts): Promise<Pick<Property, "id" | "slug" | "line1" | "line2" | "city" | "state" | "postalCode"> | null> {
  const parts = normalizeAddress(input);
  const row = (
    await tx
      .select({ id: properties.id, slug: properties.slug, line1: properties.line1, line2: properties.line2, city: properties.city, state: properties.state, postalCode: properties.postalCode })
      .from(properties)
      .where(eq(properties.addressKey, addressKey(parts)))
      .limit(1)
  )[0];
  return row ?? null;
}
