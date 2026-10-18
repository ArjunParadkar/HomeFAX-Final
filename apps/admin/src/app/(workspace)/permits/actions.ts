"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { oversight, type Permit } from "@homefax/db";
import { asWorkspace } from "@/lib/workspace";

const KINDS = new Set(["building", "electrical", "plumbing", "mechanical", "roofing", "demolition", "other"]);
const STATUSES = new Set(["applied", "issued", "inspected", "closed", "flagged", "revoked"]);

/** Fields: propertyId, permitNo, kind, status, recordId, appliedAt, issuedAt, notes. Municipality members only (RLS). → /permits */
export async function createPermitAction(fd: FormData): Promise<void> {
  const propertyId = str(fd, "propertyId");
  const kind = str(fd, "kind");
  const status = str(fd, "status") || "applied";
  if (!propertyId) fail("/permits", "Pick the property");
  if (!KINDS.has(kind)) fail("/permits", "Pick the kind of permit");
  if (!STATUSES.has(status)) fail("/permits", "Pick a status");
  try {
    await asWorkspace((tx, ws) =>
      oversight.createPermit(tx, {
        propertyId,
        municipalityOrgId: ws.org.id,
        recordId: optStr(fd, "recordId"),
        permitNo: str(fd, "permitNo"),
        kind: kind as Permit["kind"],
        status: status as Permit["status"],
        appliedAt: optStr(fd, "appliedAt"),
        issuedAt: optStr(fd, "issuedAt"),
        notes: optStr(fd, "notes"),
        createdBy: ws.me.identity.id,
        orgName: ws.org.name,
      }),
    );
  } catch (e) {
    fail("/permits", errorMessage(e));
  }
  revalidatePath("/permits");
  redirect("/permits");
}

/** Fields: permitId, status, recordId (optional). Issued permits date themselves; closed ones too. → /permits */
export async function updatePermitAction(fd: FormData): Promise<void> {
  const id = str(fd, "permitId");
  const status = str(fd, "status");
  if (!STATUSES.has(status)) fail("/permits", "Pick a status");
  const today = new Date().toISOString().slice(0, 10);
  const patch: Parameters<typeof oversight.updatePermit>[2] = { status: status as Permit["status"] };
  if (status === "issued") patch.issuedAt = today;
  if (status === "closed") patch.closedAt = today;
  if (fd.has("recordId")) patch.recordId = optStr(fd, "recordId");
  try {
    await asWorkspace((tx, ws) => oversight.updatePermit(tx, id, patch, { id: ws.me.identity.id, orgName: ws.org.name }));
  } catch (e) {
    fail("/permits", errorMessage(e));
  }
  revalidatePath("/permits");
  redirect("/permits");
}
