"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cents, errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { oversight, type Policy } from "@homefax/db";
import { asWorkspace } from "@/lib/workspace";

const KINDS = new Set(["homeowners", "builders_risk", "flood", "umbrella", "commercial"]);
const STATUSES = new Set(["quoted", "bound", "active", "lapsed", "cancelled"]);

function safeBack(v: string | null, fallback: string): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

/** Fields: propertyId, kind, policyRef, coverage ($), premium ($), effectiveFrom, effectiveTo, status, notes. Insurer members only (RLS). → /policies */
export async function createPolicyAction(fd: FormData): Promise<void> {
  const propertyId = str(fd, "propertyId");
  const kind = str(fd, "kind");
  const status = str(fd, "status") || "quoted";
  const coverageCents = cents(fd, "coverage");
  const effectiveFrom = str(fd, "effectiveFrom");
  const effectiveTo = str(fd, "effectiveTo");
  if (!propertyId) fail("/policies", "Pick the property");
  if (!KINDS.has(kind)) fail("/policies", "Pick the kind of policy");
  if (!STATUSES.has(status)) fail("/policies", "Pick a status");
  if (coverageCents == null) fail("/policies", "Enter the coverage as a dollar amount");
  if (!effectiveFrom || !effectiveTo) fail("/policies", "Give the effective dates");
  try {
    await asWorkspace((tx, ws) =>
      oversight.createPolicy(tx, {
        orgId: ws.org.id,
        propertyId,
        kind: kind as Policy["kind"],
        policyRef: optStr(fd, "policyRef"),
        coverageCents,
        premiumCents: cents(fd, "premium"),
        effectiveFrom,
        effectiveTo,
        status: status as Policy["status"],
        notes: optStr(fd, "notes"),
        createdBy: ws.me.identity.id,
        orgName: ws.org.name,
      }),
    );
  } catch (e) {
    fail("/policies", errorMessage(e));
  }
  revalidatePath("/policies");
  revalidatePath("/dashboard");
  redirect("/policies");
}

/** Fields: policyId, status, back. → back | /policies */
export async function updatePolicyStatusAction(fd: FormData): Promise<void> {
  const id = str(fd, "policyId");
  const status = str(fd, "status");
  const back = safeBack(optStr(fd, "back"), "/policies");
  if (!STATUSES.has(status)) fail(back, "Pick a status");
  try {
    await asWorkspace((tx) => oversight.updatePolicy(tx, id, { status: status as Policy["status"] }));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath("/policies");
  revalidatePath("/dashboard");
  redirect(back);
}
