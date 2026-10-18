"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { auth, people, withService } from "@homefax/db";
import { kit } from "@/lib/kit";

/**
 * Every account-layer mutation, one file. Convention (from the contractor app):
 *   - input is a plain <form> FormData
 *   - success redirects to the page that shows the result
 *   - failure redirects back to the calling page with ?error=<message>
 *     (keeping any mode/tab parameter the page needs), so every page stays a
 *     server component with no client state.
 *
 * Sign-in, sign-up, password changes and erasure touch credentials, which no
 * actor may read — they run as the service, as the auth repo's doc says.
 * Everything else runs as the signed-in person under row-level security.
 */

const SIGN_IN_WORD: Record<"locked" | "bad_credentials" | "suspended", string> = {
  locked: "Too many attempts. Wait a few minutes and try again.",
  bad_credentials: "That email and password do not match an account",
  suspended: "This account is suspended. Contact HomeFAX.",
};

/** Fields: email, password. Success → /home. Failure → /?mode=signin&error=… */
export async function signInAction(formData: FormData): Promise<void> {
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email) fail("/?mode=signin", "Enter your email");
  if (!password) fail("/?mode=signin", "Enter your password");

  const info = await kit.clientInfo();
  let token: string | null = null;
  try {
    const r = await withService((tx) => auth.signIn(tx, { email, password, app: "homeowner", ...info }));
    if (!r.ok) {
      const minutes = r.retryAfterMs ? Math.max(1, Math.ceil(r.retryAfterMs / 60_000)) : null;
      fail(
        "/?mode=signin",
        r.reason === "locked" && minutes ? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` : SIGN_IN_WORD[r.reason],
      );
    }
    token = r.token;
  } catch (e) {
    fail("/?mode=signin", errorMessage(e));
  }
  await kit.setSessionCookie(token!);
  redirect("/home");
}

/** Fields: name, email, password. Success → /home. Failure → /?mode=signup&error=… */
export async function signUpAction(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!name) fail("/?mode=signup", "Enter your name");
  if (!email) fail("/?mode=signup", "Enter your email");

  const info = await kit.clientInfo();
  let token: string | null = null;
  try {
    const r = await withService((tx) => auth.signUp(tx, { email, password, name, app: "homeowner", ...info }));
    token = r.token;
  } catch (e) {
    fail("/?mode=signup", errorMessage(e));
  }
  await kit.setSessionCookie(token!);
  redirect("/home");
}

/** No fields. Ends the session → /. */
export async function signOutAction(): Promise<void> {
  await kit.signOut();
  redirect("/");
}

/** Fields: name, handle, phone. Phone is stored encrypted; blank clears it. Success → /account?ok=profile */
export async function updateProfileAction(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  const handle = str(formData, "handle");
  const phone = optStr(formData, "phone");
  const keepPhone = formData.get("phone") === null;
  try {
    await kit.asMe((tx, me) =>
      people.updateProfile(tx, me.identity.id, {
        name: name || undefined,
        handle: handle || undefined,
        ...(keepPhone ? {} : { phone }),
      }),
    );
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account?ok=profile");
}

/** Fields: currentPassword, password, confirm. Success → /account?ok=password */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const me = await kit.requirePrincipal();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) fail("/account", "The two new passwords do not match");
  try {
    await withService((tx) => auth.changePassword(tx, me.identity.id, current, next));
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account?ok=password");
}

/** Fields: sessionId. Revokes one of the person's own sessions. Success → /account */
export async function revokeSessionAction(formData: FormData): Promise<void> {
  const sessionId = str(formData, "sessionId");
  if (!sessionId) fail("/account", "Which session?");
  try {
    await kit.asMe(async (tx, me) => {
      if (sessionId === me.session.id) throw new Error("Use Sign out to end this session");
      await auth.revokeSessionById(tx, me.identity.id, sessionId);
    });
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account");
}

/** No fields. Signs out every other device. Success → /account?ok=sessions */
export async function revokeOtherSessionsAction(): Promise<void> {
  try {
    await kit.asMe((tx, me) => auth.revokeOtherSessions(tx, me.identity.id, me.session.id));
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  revalidatePath("/account");
  redirect("/account?ok=sessions");
}

/**
 * Fields: password. Erases the account after the password is confirmed:
 * credentials gone, profile blanked, email tombstoned. Ownership rows stay as
 * the house's history. Success → /?erased=1
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const me = await kit.requirePrincipal();
  const password = String(formData.get("password") ?? "");
  if (!password) fail("/account", "Type your password to confirm");
  try {
    await withService(async (tx) => {
      if (!(await auth.checkPassword(tx, me.identity.id, password))) throw new Error("That password is not right");
      await auth.eraseIdentity(tx, me.identity.id);
    });
  } catch (e) {
    fail("/account", errorMessage(e));
  }
  await kit.clearSessionCookie();
  redirect("/?erased=1");
}
