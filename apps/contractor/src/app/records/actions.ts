"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cents, errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { isStageId } from "@homefax/core";
import { oversight, parseAddressLine, properties, records, withService, type AddressParts } from "@homefax/db";
import { kit } from "@/lib/kit";
import { orgContext } from "@/lib/session";
import { CLAIM_CODE_COOKIE, writeShowOnce, type IssuedClaimCode } from "@/lib/show-once";

/** How long a freshly issued claim code stays on screen before the page stops showing it. */
const CLAIM_CODE_SHOW_MINUTES = 15;

/**
 * Fields: address (the street line, or a whole one-line address), line2
 * (optional), city, state, zip, owner (optional). Opening a record now
 * finds-or-creates the house first — the same address typed by two builders
 * lands on one property — then opens the record for the active company.
 * Success → the new record. Failure → /records?error=…
 */
export async function createRecordAction(formData: FormData): Promise<void> {
  const address = str(formData, "address");
  const line2 = optStr(formData, "line2");
  const city = str(formData, "city");
  const state = str(formData, "state");
  const zip = str(formData, "zip");
  const ownerName = optStr(formData, "owner");
  if (!address) fail("/records", "Enter the property address");

  // A full "1418 Ridgemont Dr, Bentonville, AR 72712" typed in the street box
  // wins over the part fields; otherwise the parts must be there.
  let parts: AddressParts | null = parseAddressLine(address);
  if (!parts) {
    if (!city || !state || !zip) fail("/records", "Add the city, state and ZIP, or type the whole address on one line");
    parts = { line1: address, line2, city, state, postalCode: zip };
  } else if (line2) {
    parts = { ...parts, line2 };
  }

  let slug: string;
  try {
    const me = await kit.requirePrincipal();
    // Service: an actor cannot see a house they have no relationship with yet, so the dedup lookup needs the platform.
    const { property } = await withService((tx) => properties.findOrCreateProperty(tx, { ...parts!, createdBy: me.identity.id }));
    slug = await kit.asMe(async (tx, me) => {
      const { org } = await orgContext(tx, me);
      if (!org) throw new Error("Create your company first");
      const record = await records.createRecord(tx, { property, orgId: org.id, orgName: org.name, ownerName, createdBy: me.identity.id });
      return record.slug;
    });
  } catch (e) {
    fail("/records", errorMessage(e));
  }
  revalidatePath("/records");
  redirect(`/records/${slug}`);
}

/**
 * Fields: slug, propertyId. Mints a claim code for the homeowner and shows it
 * once on the record page (same show-once cookie as reset links). Anyone who
 * can build on the record may issue one. Success → the record page.
 */
export async function issueClaimCodeAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const propertyId = str(formData, "propertyId");
  const back = slug ? `/records/${slug}` : "/records";
  let issued: IssuedClaimCode;
  try {
    const { code } = await kit.asMe((tx, me) => properties.createOwnerInvite(tx, { propertyId, invitedBy: me.identity.id }));
    issued = { slug, code, expiresAt: new Date(Date.now() + CLAIM_CODE_SHOW_MINUTES * 60_000).toISOString() };
  } catch (e) {
    fail(back, errorMessage(e));
  }
  await writeShowOnce(CLAIM_CODE_COOKIE, "/records", issued, CLAIM_CODE_SHOW_MINUTES * 60);
  revalidatePath(back);
  redirect(back);
}

/**
 * Fields: slug, propertyId, stage, holdingId, amount (dollars). The contractor
 * asks the lender to release the draw tied to this stage; the lender decides in
 * the admin app. Success → the stage page with ?ok=draw.
 */
export async function requestDrawAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  const propertyId = str(formData, "propertyId");
  const stage = str(formData, "stage");
  const holdingId = str(formData, "holdingId");
  const amountCents = cents(formData, "amount");
  const back = slug && isStageId(stage) ? `/records/${slug}/stages/${stage}` : "/records";
  if (!isStageId(stage)) fail("/records", "Choose a stage");
  if (amountCents == null || amountCents <= 0) fail(back, "Enter the draw amount in dollars");
  if (!holdingId) fail(back, "No construction loan is on file for this property");
  try {
    await kit.asMe((tx, me) => oversight.requestDraw(tx, { holdingId, propertyId, stage, amountCents, requestedBy: me.identity.id }));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(back);
  redirect(`${back}?ok=draw`);
}
