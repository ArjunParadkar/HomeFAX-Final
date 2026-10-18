"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, str } from "@homefax/app-kit";
import { access, orgs, parseAddressLine, properties, withService, type Scope } from "@homefax/db";
import { asWorkspace } from "@/lib/workspace";

const SCOPES = new Set<string>(["summary", "ledger", "full"]);

/**
 * Fields: address (one line), scope, purpose. The institution cannot see the
 * house yet, so the lookup is a read-only service call (`properties.findByAddress`)
 * and the request is filed as the service (`access.requestAccess`) — both
 * named in the repo docs — and only after the signed-in person is confirmed a
 * member of the requesting institution. Success → /requests. Failure → /properties?error=.
 */
export async function requestAccessAction(fd: FormData): Promise<void> {
  const address = str(fd, "address");
  const scope = str(fd, "scope");
  const purpose = str(fd, "purpose");
  const parts = parseAddressLine(address);
  if (!parts) fail("/properties", "Write the address as “street, city, ST 12345”");
  if (!SCOPES.has(scope)) fail("/properties", "Pick the scope you need");

  try {
    // Who is asking, and are they really a member of the institution they claim?
    const { orgId, orgName, identityId } = await asWorkspace(async (tx, ws) => {
      const m = await orgs.getMembership(tx, ws.org.id, ws.me.identity.id);
      if (!m) throw new Error("You are not a member of this institution");
      return { orgId: ws.org.id, orgName: ws.org.name, identityId: ws.me.identity.id };
    });
    await withService(async (tx) => {
      const found = await properties.findByAddress(tx, parts!);
      if (!found) throw new Error("No HomeFAX record exists for that address yet. Ask the builder or owner to open one.");
      await access.requestAccess(tx, { propertyId: found.id, requesterOrgId: orgId, requesterIdentityId: identityId, scope: scope as Scope, purpose, orgName });
    });
  } catch (e) {
    fail("/properties", errorMessage(e));
  }
  revalidatePath("/requests");
  redirect("/requests?ok=requested");
}

/** Fields: requestId. Withdraws a pending request of the institution's own. → /requests */
export async function withdrawRequestAction(fd: FormData): Promise<void> {
  const id = str(fd, "requestId");
  try {
    await asWorkspace((tx) => access.withdrawRequest(tx, id));
  } catch (e) {
    fail("/requests", errorMessage(e));
  }
  revalidatePath("/requests");
  redirect("/requests");
}
