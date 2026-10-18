"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bool, errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { orgs } from "@homefax/db";
import { kit } from "@/lib/kit";
import { INVITE_COOKIE, asWorkspace } from "@/lib/workspace";

/**
 * Team actions. Row-level security already limits writes to owners and admins
 * of the institution; the checks here only make the error read better.
 */

/** Fields: email (optional), role (admin|member), title (optional). Mints a 7-day invitation; the link is shown once on /team. */
export async function createInvitationAction(fd: FormData): Promise<void> {
  const role = str(fd, "role") === "admin" ? "admin" : "member";
  let shown: { url: string; expiresAt: string; email: string | null } | null = null;
  try {
    const origin = await kit.origin();
    shown = await asWorkspace(async (tx, ws) => {
      if (!ws.isAdmin) throw new Error("Only owners and admins can invite");
      const { invitation, token } = await orgs.createInvitation(tx, { orgId: ws.org.id, email: optStr(fd, "email"), role, title: optStr(fd, "title"), invitedBy: ws.me.identity.id });
      return { url: `${origin}/join/${token}`, expiresAt: invitation.expiresAt.toISOString(), email: invitation.email };
    });
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  (await cookies()).set(INVITE_COOKIE, JSON.stringify(shown), { httpOnly: true, sameSite: "lax", path: "/team", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/team");
  redirect("/team");
}

/** No fields. Hides the shown invitation link (the invitation stays valid). */
export async function dismissInvitationLinkAction(): Promise<void> {
  (await cookies()).set(INVITE_COOKIE, "", { path: "/team", maxAge: 0 });
  redirect("/team");
}

/** Fields: invitationId. */
export async function revokeInvitationAction(fd: FormData): Promise<void> {
  try {
    await asWorkspace((tx) => orgs.revokeInvitation(tx, str(fd, "invitationId")));
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  redirect("/team");
}

/** Fields: membershipId. The owner cannot be removed — transfer first. */
export async function removeMemberAction(fd: FormData): Promise<void> {
  try {
    await asWorkspace((tx) => orgs.removeMember(tx, str(fd, "membershipId")));
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  redirect("/team");
}

/** Fields: membershipId, role (admin|member). */
export async function setMemberRoleAction(fd: FormData): Promise<void> {
  const role = str(fd, "role") === "admin" ? "admin" : "member";
  try {
    await asWorkspace((tx) => orgs.updateMember(tx, str(fd, "membershipId"), { role }));
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  redirect("/team");
}

/** Fields: identityId. Owner only: makes that member the owner and steps down to admin. */
export async function transferOwnershipAction(fd: FormData): Promise<void> {
  try {
    await asWorkspace(async (tx, ws) => {
      if (ws.org.role !== "owner") throw new Error("Only the owner can transfer ownership");
      await orgs.transferOwnership(tx, ws.org.id, str(fd, "identityId"));
    });
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/", "layout");
  redirect("/team");
}

/** Fields: name, headline, bio, isPublic. */
export async function updateOrgAction(fd: FormData): Promise<void> {
  try {
    await asWorkspace((tx, ws) => orgs.updateOrg(tx, ws.org.id, { name: str(fd, "name"), headline: optStr(fd, "headline"), bio: optStr(fd, "bio"), isPublic: bool(fd, "isPublic") }));
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/", "layout");
  redirect("/team?ok=org");
}

/** Fields: state, city, county, postalCode. Municipalities only. */
export async function addJurisdictionAction(fd: FormData): Promise<void> {
  try {
    await asWorkspace(async (tx, ws) => {
      if (ws.org.kind !== "municipality") throw new Error("Only a municipality has jurisdictions");
      await orgs.addJurisdiction(tx, { orgId: ws.org.id, state: str(fd, "state"), city: optStr(fd, "city"), county: optStr(fd, "county"), postalCode: optStr(fd, "postalCode") });
    });
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  revalidatePath("/jurisdiction");
  redirect("/team");
}

/** Fields: jurisdictionId. */
export async function removeJurisdictionAction(fd: FormData): Promise<void> {
  try {
    await asWorkspace((tx) => orgs.removeJurisdiction(tx, str(fd, "jurisdictionId")));
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  revalidatePath("/jurisdiction");
  redirect("/team");
}
