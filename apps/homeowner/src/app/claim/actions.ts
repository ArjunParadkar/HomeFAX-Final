"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, str } from "@homefax/app-kit";
import { normalizeClaimCode } from "@homefax/auth";
import { auth, properties, withService } from "@homefax/db";
import { kit } from "@/lib/kit";

/**
 * Fields: code; and when nobody is signed in, name, email, password too.
 *
 * Claiming is the one flow that happens before the person has any relationship
 * with the house, so it runs as the service (`properties.claimProperty`, and
 * `auth.signUp` for a new account). Both happen in one transaction: a bad code
 * never leaves a half-made account behind.
 *
 * Success → the new house. Failure → /claim?error=… (keeping the typed code).
 */
export async function claimAction(formData: FormData): Promise<void> {
  const raw = str(formData, "code");
  const code = normalizeClaimCode(raw);
  const back = (msg: string) => fail("/claim", msg, raw ? { code: raw } : {});
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) back("A claim code is eight letters and numbers, like 7KQ4-M2XR");

  const me = await kit.currentPrincipal();
  let slug: string | null = null;
  let token: string | null = null;

  try {
    if (me) {
      const property = await withService((tx) => properties.claimProperty(tx, code, me.identity.id));
      slug = property.slug;
    } else {
      const name = str(formData, "name");
      const email = str(formData, "email").toLowerCase();
      const password = String(formData.get("password") ?? "");
      if (!name) back("Enter your name");
      if (!email) back("Enter your email");
      const info = await kit.clientInfo();
      const r = await withService(async (tx) => {
        const signedUp = await auth.signUp(tx, { email, password, name, app: "homeowner", ...info });
        const property = await properties.claimProperty(tx, code, signedUp.principal.identity.id);
        return { token: signedUp.token, slug: property.slug };
      });
      token = r.token;
      slug = r.slug;
    }
  } catch (e) {
    back(errorMessage(e));
  }

  if (token) await kit.setSessionCookie(token);
  revalidatePath("/home");
  redirect(`/home/${slug}?claimed=1`);
}
