import { cookies } from "next/headers";
import type { Principal } from "@homefax/app-kit";
import { orgs, type Tx } from "@homefax/db";
import { kit } from "@/lib/kit";

/**
 * Who is here and which company they are filing as.
 *
 * The session itself lives in @homefax/app-kit (`kit`). This file adds the one
 * piece of contractor-specific state: the acting company, remembered in the
 * `hfx_org` cookie and resolved against the memberships row-level security
 * lets the person see.
 */

export const ORG_COOKIE = "hfx_org";
const ORG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The signed-in person, or null. Resolved once per request. */
export const currentUser = kit.currentPrincipal;

export type OrgContext = {
  /** Every company the person belongs to, oldest first. */
  orgs: orgs.OrgWithRole[];
  /** The one they are acting as: the cookie's choice when it names one of theirs, else the first. */
  org: orgs.OrgWithRole | null;
};

/** Companies the person is in, and the one they are acting as. Run inside the page's actor transaction. */
export async function orgContext(tx: Tx, me: Principal): Promise<OrgContext> {
  const mine = await orgs.listOrgsForIdentity(tx, me.identity.id);
  if (mine.length === 0) return { orgs: mine, org: null };
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  return { orgs: mine, org: mine.find((o) => o.id === wanted) ?? mine[0] };
}

/** The company the person is acting as, or null when they have none. */
export async function activeOrg(tx: Tx, me: Principal): Promise<orgs.OrgWithRole | null> {
  return (await orgContext(tx, me)).org;
}

export async function setActiveOrgCookie(orgId: string): Promise<void> {
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ORG_COOKIE_MAX_AGE,
  });
}

/** Where the homeowner app lives, for the claim-code instructions a contractor reads out. */
export function homeownerAppUrl(): string {
  return (process.env.HOMEOWNER_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
}
