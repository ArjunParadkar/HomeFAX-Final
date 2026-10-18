"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, str } from "@homefax/app-kit";
import { orgs, withService } from "@homefax/db";
import { kit } from "@/lib/kit";
import { setActiveOrgCookie } from "@/lib/workspace";

/**
 * Fields: token. Accepts the invitation for the signed-in person. Runs as the
 * service — the repo doc says so: an outsider cannot read the invitation row of
 * an institution they are not yet in. The token itself is the authorisation.
 * Success → /dashboard. Failure → /join/<token>?error=.
 */
export async function acceptInvitationAction(fd: FormData): Promise<void> {
  const token = str(fd, "token");
  const me = await kit.requirePrincipal(`/join/${encodeURIComponent(token)}`);
  let orgId: string | null = null;
  try {
    const org = await withService((tx) => orgs.acceptInvitation(tx, token, me.identity.id));
    orgId = org.id;
  } catch (e) {
    fail(`/join/${encodeURIComponent(token)}`, errorMessage(e));
  }
  await setActiveOrgCookie(orgId!);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
