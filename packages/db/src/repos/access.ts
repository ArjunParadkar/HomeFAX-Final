import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { hashToken, mintToken } from "@homefax/auth";
import type { Tx } from "../client";
import { newId } from "../ids";
import {
  accessLog,
  accessRequests,
  grants,
  shareLinks,
  type AccessLogRow,
  type AccessRequest,
  type AccessVia,
  type Grant,
  type ShareLink,
} from "../schema/access";
import { recordAccess, records } from "../schema/build";
import { jurisdictions, memberships, organizations } from "../schema/org";
import { properties, propertyOwners, propertyStats, type Property, type PropertyStats, type Scope } from "../schema/property";
import { addEvent } from "./properties";

export const SCOPE_RANK: Record<Scope, number> = { summary: 1, ledger: 2, full: 3 };
export const SCOPE_LABEL: Record<Scope, string> = { summary: "Summary", ledger: "Ledger", full: "Full record" };
export const SCOPE_BLURB: Record<Scope, string> = {
  summary: "The address, the running stats, and the grade of each stage.",
  ledger: "Everything in Summary, plus the 3D models, the 50-point ledger, and the findings.",
  full: "Everything in Ledger, plus materials and costs, documents, and the owner's timeline.",
};

export function scopeAtLeast(have: Scope | null, need: Scope): boolean {
  return have != null && SCOPE_RANK[have] >= SCOPE_RANK[need];
}

/**
 * How the running transaction's actor reaches a property. Mirrors
 * app.property_scope() in the database, with the *reason* attached so the
 * access log can say "via grant" rather than just "saw it".
 */
export type Reach = { scope: Scope; via: AccessVia; grantId?: string; shareLinkId?: string; orgId?: string | null } | null;

export async function reach(tx: Tx, propertyId: string, actor: { identityId: string | null; shareHash?: string | null }): Promise<Reach> {
  const role = (await tx.execute<{ r: string }>(sql`SELECT coalesce(current_setting('app.role', true), '') AS r`))[0]?.r;
  if (role === "service") return { scope: "full", via: "service" };
  const id = actor.identityId;
  if (id) {
    const owner = await tx
      .select({ id: propertyOwners.id })
      .from(propertyOwners)
      .where(and(eq(propertyOwners.propertyId, propertyId), eq(propertyOwners.identityId, id), isNull(propertyOwners.until)))
      .limit(1);
    if (owner.length) return { scope: "full", via: "owner" };
    const project = await tx
      .select({ orgId: recordAccess.orgId })
      .from(records)
      .innerJoin(recordAccess, eq(recordAccess.recordId, records.id))
      .innerJoin(memberships, and(eq(memberships.orgId, recordAccess.orgId), eq(memberships.identityId, id)))
      .where(eq(records.propertyId, propertyId))
      .limit(1);
    if (project.length) return { scope: "full", via: "project", orgId: project[0].orgId };
    const myOrgs = (await tx.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.identityId, id))).map((r) => r.orgId);
    const g = await tx
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.propertyId, propertyId),
          isNull(grants.revokedAt),
          or(isNull(grants.expiresAt), gt(grants.expiresAt, new Date())),
          myOrgs.length ? or(eq(grants.granteeIdentityId, id), inArray(grants.granteeOrgId, myOrgs)) : eq(grants.granteeIdentityId, id),
        ),
      );
    const bestGrant = g.sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope])[0];
    let best: Reach = bestGrant ? { scope: bestGrant.scope, via: "grant", grantId: bestGrant.id, orgId: bestGrant.granteeOrgId } : null;
    if (!best || SCOPE_RANK[best.scope] < 2) {
      const muni = await tx
        .select({ orgId: jurisdictions.orgId })
        .from(properties)
        .innerJoin(
          jurisdictions,
          and(
            eq(jurisdictions.state, properties.state),
            or(
              sql`${jurisdictions.city} IS NOT NULL AND upper(${jurisdictions.city}) = upper(${properties.city})`,
              sql`${jurisdictions.county} IS NOT NULL AND ${properties.county} IS NOT NULL AND upper(${jurisdictions.county}) = upper(${properties.county})`,
              sql`${jurisdictions.postalCode} IS NOT NULL AND ${jurisdictions.postalCode} = ${properties.postalCode}`,
            ),
          ),
        )
        .innerJoin(organizations, and(eq(organizations.id, jurisdictions.orgId), eq(organizations.kind, "municipality")))
        .innerJoin(memberships, and(eq(memberships.orgId, jurisdictions.orgId), eq(memberships.identityId, id)))
        .where(eq(properties.id, propertyId))
        .limit(1);
      if (muni.length) best = { scope: "ledger", via: "jurisdiction", orgId: muni[0].orgId };
    }
    if (best) return best;
  }
  if (actor.shareHash) {
    const link = (
      await tx
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.propertyId, propertyId), eq(shareLinks.tokenHash, actor.shareHash), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date()))))
        .limit(1)
    )[0];
    if (link) return { scope: link.scope, via: "share_link", shareLinkId: link.id, orgId: link.createdByOrgId };
  }
  return null;
}

/** Record a look at a property. Owners' own views are not logged. */
export async function logAccess(
  tx: Tx,
  input: { propertyId: string; viewerIdentityId: string | null; viewerOrgId?: string | null; via: AccessVia; scope: Scope; app: string; path?: string | null; shareLinkId?: string | null },
): Promise<void> {
  if (input.via === "owner") return;
  await tx.insert(accessLog).values({
    propertyId: input.propertyId,
    viewerIdentityId: input.viewerIdentityId,
    viewerOrgId: input.viewerOrgId ?? null,
    via: input.via,
    scope: input.scope,
    app: input.app,
    path: input.path ?? null,
    shareLinkId: input.shareLinkId ?? null,
  });
}

export async function listAccessLog(tx: Tx, propertyId: string, limit = 100): Promise<AccessLogRow[]> {
  return tx.select().from(accessLog).where(eq(accessLog.propertyId, propertyId)).orderBy(desc(accessLog.at)).limit(limit);
}
export async function listAccessLogForOrg(tx: Tx, orgId: string, limit = 200): Promise<AccessLogRow[]> {
  return tx.select().from(accessLog).where(eq(accessLog.viewerOrgId, orgId)).orderBy(desc(accessLog.at)).limit(limit);
}

/* -------------------------------- grants -------------------------------- */

export async function listGrants(tx: Tx, propertyId: string, includeRevoked = false): Promise<Grant[]> {
  return tx
    .select()
    .from(grants)
    .where(includeRevoked ? eq(grants.propertyId, propertyId) : and(eq(grants.propertyId, propertyId), isNull(grants.revokedAt)))
    .orderBy(desc(grants.createdAt));
}

export type GrantWithProperty = { grant: Grant; property: Property; stats: PropertyStats };
export async function listGrantsForOrg(tx: Tx, orgId: string): Promise<GrantWithProperty[]> {
  return tx
    .select({ grant: grants, property: properties, stats: propertyStats })
    .from(grants)
    .innerJoin(properties, eq(properties.id, grants.propertyId))
    .innerJoin(propertyStats, eq(propertyStats.propertyId, properties.id))
    .where(and(eq(grants.granteeOrgId, orgId), isNull(grants.revokedAt), or(isNull(grants.expiresAt), gt(grants.expiresAt, new Date()))))
    .orderBy(desc(grants.createdAt));
}

export async function grantAccess(
  tx: Tx,
  input: { propertyId: string; granteeOrgId?: string | null; granteeIdentityId?: string | null; scope: Scope; purpose?: string | null; grantedBy: string; expiresAt?: Date | null; granteeName?: string },
): Promise<Grant> {
  if (!input.granteeOrgId === !input.granteeIdentityId) throw new Error("Grant to exactly one organisation or person");
  const [row] = await tx
    .insert(grants)
    .values({
      id: newId(),
      propertyId: input.propertyId,
      granteeOrgId: input.granteeOrgId ?? null,
      granteeIdentityId: input.granteeIdentityId ?? null,
      scope: input.scope,
      purpose: input.purpose?.trim() || null,
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  await addEvent(tx, {
    propertyId: input.propertyId,
    kind: "access_granted",
    title: `${SCOPE_LABEL[input.scope]} access granted${input.granteeName ? ` to ${input.granteeName}` : ""}`,
    detail: input.purpose ?? null,
    actorId: input.grantedBy,
  });
  return row;
}

export async function revokeGrant(tx: Tx, id: string, by: string): Promise<void> {
  const [row] = await tx.update(grants).set({ revokedAt: new Date(), revokedBy: by }).where(and(eq(grants.id, id), isNull(grants.revokedAt))).returning();
  if (row) await addEvent(tx, { propertyId: row.propertyId, kind: "access_revoked", title: "Access revoked", actorId: by });
}

/* -------------------------------- requests ------------------------------ */

/**
 * An institution asks the owner for access. Runs as the SERVICE: the requester
 * has no scope on the property yet, so neither the request row's event nor the
 * property itself is visible to them. The app verifies the actor is a member
 * of requesterOrgId before calling.
 */
export async function requestAccess(
  tx: Tx,
  input: { propertyId: string; requesterOrgId: string; requesterIdentityId: string; scope: Scope; purpose: string; orgName?: string },
): Promise<AccessRequest> {
  const purpose = input.purpose.trim();
  if (purpose.length < 8) throw new Error("Say why you need access, in a sentence");
  const open = (
    await tx
      .select()
      .from(accessRequests)
      .where(and(eq(accessRequests.propertyId, input.propertyId), eq(accessRequests.requesterOrgId, input.requesterOrgId), eq(accessRequests.status, "pending")))
      .limit(1)
  )[0];
  if (open) return open;
  const [row] = await tx
    .insert(accessRequests)
    .values({ id: newId(), propertyId: input.propertyId, requesterOrgId: input.requesterOrgId, requesterIdentityId: input.requesterIdentityId, scope: input.scope, purpose })
    .returning();
  await addEvent(tx, {
    propertyId: input.propertyId,
    kind: "access_requested",
    title: `${input.orgName ?? "An organisation"} requested ${SCOPE_LABEL[input.scope].toLowerCase()} access`,
    detail: purpose,
    actorId: input.requesterIdentityId,
    actorOrgId: input.requesterOrgId,
  });
  return row;
}

export async function listRequestsForProperty(tx: Tx, propertyId: string, status?: AccessRequest["status"]): Promise<AccessRequest[]> {
  return tx
    .select()
    .from(accessRequests)
    .where(status ? and(eq(accessRequests.propertyId, propertyId), eq(accessRequests.status, status)) : eq(accessRequests.propertyId, propertyId))
    .orderBy(desc(accessRequests.createdAt));
}

export type RequestWithProperty = { request: AccessRequest; property: Property };
export async function listRequestsForOrg(tx: Tx, orgId: string): Promise<RequestWithProperty[]> {
  return tx
    .select({ request: accessRequests, property: properties })
    .from(accessRequests)
    .innerJoin(properties, eq(properties.id, accessRequests.propertyId))
    .where(eq(accessRequests.requesterOrgId, orgId))
    .orderBy(desc(accessRequests.createdAt));
}

export type RequestWithAddress = { request: AccessRequest; address: Pick<Property, "id" | "slug" | "line1" | "line2" | "city" | "state" | "postalCode"> };
/**
 * Service: every request an institution has filed, with only the address of
 * each house. A pending request is, by definition, on a house the requester
 * cannot see yet, so the actor-level join in listRequestsForOrg hides exactly
 * the rows a "your requests" page is for. The address is what the requester
 * typed; nothing else about the house comes back. The app must verify the
 * actor is a member of requesterOrgId before calling.
 */
export async function listRequestsForOrgAsService(tx: Tx, orgId: string): Promise<RequestWithAddress[]> {
  return tx
    .select({
      request: accessRequests,
      address: { id: properties.id, slug: properties.slug, line1: properties.line1, line2: properties.line2, city: properties.city, state: properties.state, postalCode: properties.postalCode },
    })
    .from(accessRequests)
    .innerJoin(properties, eq(properties.id, accessRequests.propertyId))
    .where(eq(accessRequests.requesterOrgId, orgId))
    .orderBy(desc(accessRequests.createdAt));
}

/** Pending requests across every property the actor owns. */
export async function listPendingRequestsForOwner(tx: Tx, identityId: string): Promise<RequestWithProperty[]> {
  return tx
    .select({ request: accessRequests, property: properties })
    .from(accessRequests)
    .innerJoin(properties, eq(properties.id, accessRequests.propertyId))
    .innerJoin(propertyOwners, and(eq(propertyOwners.propertyId, properties.id), eq(propertyOwners.identityId, identityId), isNull(propertyOwners.until)))
    .where(eq(accessRequests.status, "pending"))
    .orderBy(desc(accessRequests.createdAt));
}

export async function decideRequest(tx: Tx, id: string, decision: "approved" | "denied", by: string, opts: { scope?: Scope; expiresAt?: Date | null; orgName?: string } = {}): Promise<AccessRequest> {
  const req = (await tx.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1))[0];
  if (!req) throw new Error("Request not found");
  if (req.status !== "pending") throw new Error("This request was already decided");
  let grantId: string | null = null;
  if (decision === "approved") {
    const g = await grantAccess(tx, {
      propertyId: req.propertyId,
      granteeOrgId: req.requesterOrgId,
      scope: opts.scope ?? req.scope,
      purpose: req.purpose,
      grantedBy: by,
      expiresAt: opts.expiresAt ?? null,
      granteeName: opts.orgName,
    });
    grantId = g.id;
  }
  const [row] = await tx.update(accessRequests).set({ status: decision, decidedBy: by, decidedAt: new Date(), grantId }).where(eq(accessRequests.id, id)).returning();
  return row;
}

export async function withdrawRequest(tx: Tx, id: string): Promise<void> {
  await tx.update(accessRequests).set({ status: "withdrawn", decidedAt: new Date() }).where(and(eq(accessRequests.id, id), eq(accessRequests.status, "pending")));
}

/* ------------------------------ share links ----------------------------- */

export async function createShareLink(
  tx: Tx,
  input: { propertyId: string; scope: Scope; label?: string | null; createdBy: string; createdByOrgId?: string | null; expiresAt?: Date | null },
): Promise<{ link: ShareLink; token: string }> {
  const { token, tokenHash } = mintToken(24);
  const [link] = await tx
    .insert(shareLinks)
    .values({
      id: newId(),
      propertyId: input.propertyId,
      tokenHash,
      scope: input.scope,
      label: input.label?.trim() || null,
      createdBy: input.createdBy,
      createdByOrgId: input.createdByOrgId ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  await addEvent(tx, { propertyId: input.propertyId, kind: "share_link_created", title: `Share link created (${SCOPE_LABEL[input.scope].toLowerCase()})`, detail: input.label ?? null, actorId: input.createdBy, actorOrgId: input.createdByOrgId ?? null });
  return { link, token };
}

export async function listShareLinks(tx: Tx, propertyId: string): Promise<ShareLink[]> {
  return tx.select().from(shareLinks).where(eq(shareLinks.propertyId, propertyId)).orderBy(desc(shareLinks.createdAt));
}

export async function revokeShareLink(tx: Tx, id: string): Promise<void> {
  await tx.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, id));
}

/** Service: a visitor opened /r/<token>. Returns the link and bumps the counter. */
export async function resolveShareLink(tx: Tx, token: string): Promise<{ link: ShareLink; property: Property } | null> {
  const tokenHash = hashToken(token);
  const rows = await tx
    .select({ link: shareLinks, property: properties })
    .from(shareLinks)
    .innerJoin(properties, eq(properties.id, shareLinks.propertyId))
    .where(and(eq(shareLinks.tokenHash, tokenHash), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date()))))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await tx.update(shareLinks).set({ viewCount: sql`${shareLinks.viewCount} + 1`, lastViewedAt: new Date() }).where(eq(shareLinks.id, row.link.id));
  return row;
}
