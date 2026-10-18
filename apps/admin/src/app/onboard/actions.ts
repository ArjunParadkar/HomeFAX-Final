"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { orgs } from "@homefax/db";
import { kit } from "@/lib/kit";
import { isWorkspaceKind, setActiveOrgCookie } from "@/lib/workspace";

/**
 * Fields: name, kind (municipality|lender|insurer|brokerage), headline (optional),
 * and for municipalities state + city | county | postalCode for the first
 * jurisdiction. Runs as the actor: the org insert policy requires the owner to
 * be the signer, and the jurisdiction insert sees the fresh owner membership
 * in the same transaction. Success → /dashboard. Failure → /onboard?error=.
 */
export async function registerInstitutionAction(fd: FormData): Promise<void> {
  const name = str(fd, "name");
  const kind = str(fd, "kind");
  const headline = optStr(fd, "headline");
  if (!isWorkspaceKind(kind)) fail("/onboard", "Choose what kind of institution this is");
  if (name.length < 2) fail("/onboard", "Give the institution its name");
  const state = str(fd, "state");
  const city = optStr(fd, "city");
  const county = optStr(fd, "county");
  const postalCode = optStr(fd, "postalCode");
  if (kind === "municipality" && !state) fail("/onboard", "A municipality needs its first jurisdiction: state plus a city, county, or ZIP");

  let orgId: string | null = null;
  try {
    orgId = await kit.asMe(async (tx, me) => {
      const org = await orgs.createOrg(tx, { kind, name, headline, ownerIdentityId: me.identity.id, isPublic: kind === "municipality" });
      if (kind === "municipality") await orgs.addJurisdiction(tx, { orgId: org.id, state, city, county, postalCode });
      return org.id;
    });
  } catch (e) {
    fail("/onboard", errorMessage(e));
  }
  await setActiveOrgCookie(orgId!);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
