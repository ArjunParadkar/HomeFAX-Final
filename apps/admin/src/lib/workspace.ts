import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { orgs, withActor, type OrgKind, type Tx } from "@homefax/db";
import type { Principal } from "@homefax/app-kit";
import { kit } from "./kit";

/**
 * One app, four workspaces. The workspace is the signed-in person plus the
 * institution they are acting for right now. A person who belongs to several
 * institutions switches in the rail; the choice lives in a cookie.
 */

export const ORG_COOKIE = "hfx_admin_org";
/** A freshly minted invitation link, shown once on /team. */
export const INVITE_COOKIE = "hfx_admin_invite";

export const WORKSPACE_KINDS = ["municipality", "lender", "insurer", "brokerage"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export function isWorkspaceKind(k: string): k is WorkspaceKind {
  return (WORKSPACE_KINDS as readonly string[]).includes(k);
}

export const KIND_LABEL: Record<WorkspaceKind, string> = {
  municipality: "Municipality",
  lender: "Lender",
  insurer: "Insurer",
  brokerage: "Brokerage",
};

export type WorkspaceOrg = orgs.OrgWithRole & { kind: WorkspaceKind };

export type Workspace = {
  me: Principal;
  org: WorkspaceOrg;
  /** Every institution the person belongs to, for the switcher. */
  all: WorkspaceOrg[];
  isAdmin: boolean;
};

const institutionsOf = cache(async (): Promise<{ me: Principal; all: WorkspaceOrg[] } | null> => {
  const me = await kit.currentPrincipal();
  if (!me) return null;
  const mine = await withActor({ identityId: me.identity.id }, (tx) => orgs.listOrgsForIdentity(tx, me.identity.id));
  const all = mine.filter((o): o is WorkspaceOrg => isWorkspaceKind(o.kind));
  return { me, all };
});

/** The current workspace, or null when the person is signed out or has no institution yet. */
export const currentWorkspace = cache(async (): Promise<Workspace | null> => {
  const base = await institutionsOf();
  if (!base || base.all.length === 0) return null;
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const org = base.all.find((o) => o.id === wanted) ?? base.all[0];
  return { me: base.me, org, all: base.all, isAdmin: org.role === "owner" || org.role === "admin" };
});

/** Signed-out → `/`; signed in without an institution → `/onboard`. */
export async function requireWorkspace(): Promise<Workspace> {
  const me = await kit.currentPrincipal();
  if (!me) redirect("/");
  const ws = await currentWorkspace();
  if (!ws) redirect("/onboard");
  return ws;
}

/** Pages that belong to one workspace kind send everyone else to their own dashboard. */
export async function requireKind<K extends WorkspaceKind>(kind: K): Promise<Workspace & { org: WorkspaceOrg & { kind: K } }> {
  const ws = await requireWorkspace();
  if (ws.org.kind !== kind) redirect("/dashboard");
  return ws as Workspace & { org: WorkspaceOrg & { kind: K } };
}

/** Run as the signed-in person with the workspace in hand. Row-level security decides what comes back. */
export async function asWorkspace<T>(fn: (tx: Tx, ws: Workspace) => Promise<T>): Promise<T> {
  const ws = await requireWorkspace();
  return withActor({ identityId: ws.me.identity.id }, (tx) => fn(tx, ws));
}

export async function setActiveOrgCookie(orgId: string): Promise<void> {
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 86400,
  });
}

export type { OrgKind };
