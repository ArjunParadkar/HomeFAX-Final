"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cents, errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { access, oversight, type Listing } from "@homefax/db";
import { asWorkspace } from "@/lib/workspace";

const STATUSES = new Set(["draft", "active", "pending", "sold", "withdrawn"]);
const BUYER_REPORT_DAYS = 90;

/** Fields: propertyId, listPrice ($), mlsRef, agentIdentityId, status, listedAt, notes. Brokerage members only (RLS). → /listings/<id> */
export async function createListingAction(fd: FormData): Promise<void> {
  const propertyId = str(fd, "propertyId");
  const status = str(fd, "status") || "draft";
  if (!propertyId) fail("/listings", "Pick the property");
  if (!STATUSES.has(status)) fail("/listings", "Pick a status");
  let id: string | null = null;
  try {
    id = await asWorkspace(async (tx, ws) => {
      const row = await oversight.createListing(tx, {
        orgId: ws.org.id,
        propertyId,
        agentIdentityId: optStr(fd, "agentIdentityId"),
        listPriceCents: cents(fd, "listPrice"),
        status: status as Listing["status"],
        mlsRef: optStr(fd, "mlsRef"),
        listedAt: optStr(fd, "listedAt"),
        notes: optStr(fd, "notes"),
        orgName: ws.org.name,
        actorId: ws.me.identity.id,
      });
      return row.id;
    });
  } catch (e) {
    fail("/listings", errorMessage(e));
  }
  revalidatePath("/listings");
  revalidatePath("/dashboard");
  redirect(`/listings/${id}`);
}

/** Fields: listingId, status, soldPrice ($, when sold). → /listings/<id> */
export async function updateListingStatusAction(fd: FormData): Promise<void> {
  const id = str(fd, "listingId");
  const status = str(fd, "status");
  const back = `/listings/${id}`;
  if (!STATUSES.has(status)) fail(back, "Pick a status");
  const patch: Parameters<typeof oversight.updateListing>[2] = { status: status as Listing["status"] };
  if (status === "sold") {
    patch.closedAt = new Date().toISOString().slice(0, 10);
    const sold = cents(fd, "soldPrice");
    if (sold != null) patch.soldPriceCents = sold;
  }
  try {
    await asWorkspace((tx, ws) => oversight.updateListing(tx, id, patch, ws.me.identity.id));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath("/listings");
  revalidatePath(back);
  revalidatePath("/dashboard");
  redirect(back);
}

/**
 * Fields: listingId. Mints a 90-day ledger-scope share link on the listing's
 * house and stores it on the listing. RLS insists the brokerage hold full scope
 * from the owner; otherwise the error says to ask for it. The token is shown
 * once via ?token= on the listing page and never stored in clear. → /listings/<id>
 */
export async function createBuyerReportAction(fd: FormData): Promise<void> {
  const id = str(fd, "listingId");
  const back = `/listings/${id}`;
  let token: string | null = null;
  try {
    token = await asWorkspace(async (tx, ws) => {
      const listing = await oversight.getListing(tx, id);
      if (!listing) throw new Error("Listing not found");
      const { link, token } = await access.createShareLink(tx, {
        propertyId: listing.propertyId,
        scope: "ledger",
        label: `Buyer report — listing ${listing.mlsRef ?? listing.id}`,
        createdBy: ws.me.identity.id,
        createdByOrgId: ws.org.id,
        expiresAt: new Date(Date.now() + BUYER_REPORT_DAYS * 86400_000),
      });
      await oversight.updateListing(tx, id, { shareLinkId: link.id });
      return token;
    });
  } catch (e) {
    const msg = errorMessage(e);
    fail(back, /permission/i.test(msg) ? "Ask the owner for full access first — a buyer report needs the full record behind it" : msg);
  }
  revalidatePath(back);
  revalidatePath("/listings");
  redirect(`${back}?token=${encodeURIComponent(token!)}`);
}

/** Fields: listingId, shareLinkId. Revokes the buyer report link. → /listings/<id> */
export async function revokeBuyerReportAction(fd: FormData): Promise<void> {
  const id = str(fd, "listingId");
  const back = `/listings/${id}`;
  try {
    await asWorkspace(async (tx) => {
      await access.revokeShareLink(tx, str(fd, "shareLinkId"));
      await oversight.updateListing(tx, id, { shareLinkId: null });
    });
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(back);
  revalidatePath("/listings");
  redirect(back);
}
