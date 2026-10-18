"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { errorMessage, fail, num, optStr, str } from "@homefax/app-kit";
import { access, orgs, properties, type Scope } from "@homefax/db";
import { kit } from "@/lib/kit";
import { SHARE_LINK_COOKIE } from "@/lib/share";
import { isDocumentKind } from "@/lib/storage";

/**
 * The owner's control panel, one file. Every write runs as the signed-in
 * person; row-level security refuses anything they do not own and
 * `errorMessage` turns that refusal into one plain line.
 *
 * Fields are the contract with the pages — `slug` says where to go back to.
 */

const SCOPES: Scope[] = ["summary", "ledger", "full"];
function scopeOf(v: string): Scope | null {
  return (SCOPES as string[]).includes(v) ? (v as Scope) : null;
}

/** Fields: slug, grantId. Success → /home/[slug]/access */
export async function revokeGrantAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const grantId = str(formData, "grantId");
  const back = `/home/${slug}/access`;
  if (!grantId) fail(back, "Which grant?");
  try {
    await kit.asMe((tx, me) => access.revokeGrant(tx, grantId, me.identity.id));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(back);
  redirect(back);
}

/**
 * Fields: slug, requestId, decision ("approve" | "approve_summary" | "deny").
 * Approve grants at the requested scope; approve_summary grants summary only.
 * Success → /home/[slug]/access
 */
export async function decideRequestAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const requestId = str(formData, "requestId");
  const decision = str(formData, "decision");
  const back = `/home/${slug}/access`;
  if (!requestId) fail(back, "Which request?");
  try {
    await kit.asMe(async (tx, me) => {
      const req = (await access.listRequestsForProperty(tx, (await properties.getPropertyBySlug(tx, slug))?.id ?? "", "pending")).find(
        (r) => r.id === requestId,
      );
      if (!req) throw new Error("That request is no longer pending");
      const org = await orgs.getOrg(tx, req.requesterOrgId);
      if (decision === "deny") {
        await access.decideRequest(tx, requestId, "denied", me.identity.id, { orgName: org?.name });
      } else if (decision === "approve_summary") {
        await access.decideRequest(tx, requestId, "approved", me.identity.id, { scope: "summary", orgName: org?.name });
      } else if (decision === "approve") {
        await access.decideRequest(tx, requestId, "approved", me.identity.id, { orgName: org?.name });
      } else {
        throw new Error("Approve, approve summary only, or deny");
      }
    });
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(back);
  revalidatePath("/home");
  redirect(back);
}

/**
 * Fields: slug, propertyId, label (optional), scope, expires ("7" | "30" | "90" | "never").
 * The token is minted once; the URL goes into a short-lived cookie the access
 * page reads back and shows a single time. Success → /home/[slug]/access
 */
export async function createShareLinkAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const propertyId = str(formData, "propertyId");
  const label = optStr(formData, "label");
  const scope = scopeOf(str(formData, "scope"));
  const expires = str(formData, "expires");
  const back = `/home/${slug}/access`;
  if (!propertyId) fail(back, "Which house?");
  if (!scope) fail(back, "Pick what the link may show");
  const days = expires === "never" ? null : num(formData, "expires");
  if (expires !== "never" && !(days && [7, 30, 90].includes(days))) fail(back, "Pick how long the link lasts");

  let url: string | null = null;
  try {
    const { token, link } = await kit.asMe((tx, me) =>
      access.createShareLink(tx, {
        propertyId,
        scope: scope!,
        label,
        createdBy: me.identity.id,
        expiresAt: days ? new Date(Date.now() + days * 86400_000) : null,
      }),
    );
    url = `${await kit.origin()}/r/${token}`;
    const jar = await cookies();
    jar.set(SHARE_LINK_COOKIE, JSON.stringify({ url, linkId: link.id, label: link.label }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: back,
      maxAge: 15 * 60,
    });
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(back);
  redirect(back);
}

/** Fields: slug. Clears the shown share URL (the link itself keeps working). */
export async function dismissShareLinkAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const back = `/home/${slug}/access`;
  const jar = await cookies();
  jar.set(SHARE_LINK_COOKIE, "", { path: back, maxAge: 0 });
  redirect(back);
}

/** Fields: slug, linkId. Success → /home/[slug]/access */
export async function revokeShareLinkAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const linkId = str(formData, "linkId");
  const back = `/home/${slug}/access`;
  if (!linkId) fail(back, "Which link?");
  try {
    await kit.asMe((tx) => access.revokeShareLink(tx, linkId));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(back);
  redirect(back);
}

/**
 * Fields: propertyId, kind, title, blobUrl, contentType, sizeBytes. The file is
 * already in Blob storage (client upload); this files the row and the event.
 * Success → /home/[slug]/documents
 */
export async function addDocumentAction(formData: FormData): Promise<void> {
  const propertyId = str(formData, "propertyId");
  const kind = str(formData, "kind");
  const title = str(formData, "title");
  const blobUrl = str(formData, "blobUrl");
  const contentType = optStr(formData, "contentType");
  const sizeBytes = num(formData, "sizeBytes");

  let slug = "";
  try {
    slug = await kit.asMe(async (tx, me) => {
      const property = await properties.getProperty(tx, propertyId);
      if (!property) throw new Error("That house is not on your record");
      if (!isDocumentKind(kind)) throw new Error("Pick what kind of document this is");
      if (!/^https:\/\//.test(blobUrl)) throw new Error("The upload did not finish");
      await properties.addDocument(tx, { propertyId, kind, title, blobUrl, contentType, sizeBytes, uploadedBy: me.identity.id });
      return property.slug;
    });
  } catch (e) {
    fail(slug ? `/home/${slug}/documents` : "/home", errorMessage(e));
  }
  revalidatePath(`/home/${slug}/documents`);
  redirect(`/home/${slug}/documents`);
}

/** Fields: slug, documentId. Owners may remove any document on their house. Success → /home/[slug]/documents */
export async function removeDocumentAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const documentId = str(formData, "documentId");
  const back = `/home/${slug}/documents`;
  if (!documentId) fail(back, "Which document?");
  try {
    await kit.asMe((tx) => properties.removeDocument(tx, documentId));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(back);
  redirect(back);
}
