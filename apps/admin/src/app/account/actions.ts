"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { auth, orgs, people, withActor, withService } from "@homefax/db";
import { kit } from "@/lib/kit";
import { ORG_COOKIE, isWorkspaceKind, setActiveOrgCookie } from "@/lib/workspace";
import { cookies } from "next/headers";

/**
 * Account-layer actions. Convention: FormData in, validate with the app-kit
 * helpers, call a repo, revalidate, redirect. Failures redirect back with
 * ?error= so every page stays a server component.
 *
 * Sign-in and sign-up run as the service — the only place this file does.
 */

/** Where to land after signing in: the page that asked, else the dashboard (onboard when there is no institution yet). */
async function landing(next: string | null): Promise<string> {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  const me = await kit.currentPrincipal();
  if (!me) return "/";
  const mine = await withActor({ identityId: me.identity.id }, (tx) => orgs.listOrgsForIdentity(tx, me.identity.id));
  return mine.some((o) => isWorkspaceKind(o.kind)) ? "/dashboard" : "/onboard";
}

/** Fields: email, password, next (optional path). Success → next | /dashboard | /onboard. Failure → back?mode=signin&error=. */
export async function signInAction(fd: FormData): Promise<void> {
  const email = str(fd, "email");
  const password = String(fd.get("password") ?? "");
  const next = optStr(fd, "next");
  const back = next ?? "/";
  if (!email || !password) fail(back, "Enter your email and password", { mode: "signin" });
  const { ip, userAgent } = await kit.clientInfo();
  let token: string | null = null;
  try {
    const r = await withService((tx) => auth.signIn(tx, { email, password, app: "admin", ip, userAgent }));
    if (!r.ok) {
      if (r.reason === "locked") fail(back, `Too many attempts. Try again in ${Math.ceil((r.retryAfterMs ?? 0) / 60000)} minutes`, { mode: "signin" });
      if (r.reason === "suspended") fail(back, "This account is suspended", { mode: "signin" });
      fail(back, "That email and password do not match", { mode: "signin" });
    }
    token = r.token;
  } catch (e) {
    fail(back, errorMessage(e), { mode: "signin" });
  }
  await kit.setSessionCookie(token!);
  redirect(await landing(next));
}

/** Fields: name, email, password, headline (optional), next (optional). Success → next | /onboard. Failure → back?mode=signup&error=. */
export async function signUpAction(fd: FormData): Promise<void> {
  const name = str(fd, "name");
  const email = str(fd, "email");
  const password = String(fd.get("password") ?? "");
  const headline = optStr(fd, "headline");
  const next = optStr(fd, "next");
  const back = next ?? "/";
  if (!name) fail(back, "Your name is required", { mode: "signup" });
  const { ip, userAgent } = await kit.clientInfo();
  let token: string | null = null;
  try {
    const r = await withService((tx) => auth.signUp(tx, { email, password, name, headline: headline ?? undefined, app: "admin", ip, userAgent }));
    token = r.token;
  } catch (e) {
    fail(back, errorMessage(e), { mode: "signup" });
  }
  await kit.setSessionCookie(token!);
  redirect(next ?? "/onboard");
}

/** No fields. Revokes the session row, drops the cookie → /. */
export async function signOutAction(): Promise<void> {
  await kit.signOut();
  (await cookies()).set(ORG_COOKIE, "", { path: "/", maxAge: 0 });
  redirect("/");
}

/** Fields: orgId. Switches the acting institution, after checking membership → /dashboard. */
export async function setActiveOrgAction(fd: FormData): Promise<void> {
  const orgId = str(fd, "orgId");
  const ok = await kit.asMe(async (tx, me) => (await orgs.getMembership(tx, orgId, me.identity.id)) != null);
  if (!ok) fail("/dashboard", "You are not a member of that institution");
  await setActiveOrgCookie(orgId);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Fields: name, handle, headline, bio, phone. Success → /account?ok=profile. */
export async function updateProfileAction(fd: FormData): Promise<void> {
  try {
    await kit.asMe((tx, me) =>
      people.updateProfile(tx, me.identity.id, {
        name: str(fd, "name"),
        handle: str(fd, "handle"),
        headline: optStr(fd, "headline"),
        bio: optStr(fd, "bio"),
        phone: optStr(fd, "phone"),
      }),
    );
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account?ok=profile");
}

/** Fields: currentPassword, password, confirm. Service-level because it touches credentials, after the session proves who is asking. Success → /account?ok=password. */
export async function changePasswordAction(fd: FormData): Promise<void> {
  const me = await kit.requirePrincipal();
  const current = String(fd.get("currentPassword") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password !== confirm) fail("/account", "The two new passwords do not match");
  try {
    await withService((tx) => auth.changePassword(tx, me.identity.id, current, password));
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account?ok=password");
}

/** Fields: sessionId. Revokes one of the person's own sessions → /account. */
export async function revokeSessionAction(fd: FormData): Promise<void> {
  const sessionId = str(fd, "sessionId");
  try {
    await kit.asMe((tx, me) => auth.revokeSessionById(tx, me.identity.id, sessionId));
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account");
}

/** No fields. Signs out every other device → /account?ok=sessions. */
export async function revokeOtherSessionsAction(): Promise<void> {
  try {
    await kit.asMe((tx, me) => auth.revokeOtherSessions(tx, me.identity.id, me.session.id));
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account?ok=sessions");
}
