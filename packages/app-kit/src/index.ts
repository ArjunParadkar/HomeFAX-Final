import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, sessionCookieOptions, type HomefaxApp } from "@homefax/auth";
import { access, auth, withActor, withService, type AccessVia, type Actor, type Scope, type Tx } from "@homefax/db";

export type Principal = auth.Principal;

/**
 * One of these per app, in `src/lib/kit.ts`:
 *
 *   export const kit = createAppKit("homeowner");
 *
 * Then pages do `const me = await kit.requirePrincipal()` and
 * `await kit.asMe((tx, me) => …)`; sign-in actions do
 * `kit.setSessionCookie(token)`. Every read runs under row-level security as
 * the signed-in person; only sign-in/sign-up/claim flows use withService.
 */
export function createAppKit(app: HomefaxApp) {
  const cookieName = SESSION_COOKIE[app];
  const secure = process.env.NODE_ENV === "production";

  /** The signed-in person, resolved once per request. */
  const currentPrincipal = cache(async (): Promise<Principal | null> => {
    const jar = await cookies();
    const token = jar.get(cookieName)?.value;
    if (!token) return null;
    try {
      return await withService((tx) => auth.resolveSession(tx, token, app));
    } catch {
      return null;
    }
  });

  async function requirePrincipal(redirectTo = "/"): Promise<Principal> {
    const p = await currentPrincipal();
    if (!p) redirect(redirectTo);
    return p;
  }

  /** IP and user agent for the sessions table and sign-in throttling. */
  async function clientInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    const ip = (fwd ? fwd.split(",")[0] : h.get("x-real-ip"))?.trim() || null;
    return { ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null, userAgent: h.get("user-agent") };
  }

  async function setSessionCookie(token: string): Promise<void> {
    (await cookies()).set(cookieName, token, sessionCookieOptions(secure));
  }

  async function clearSessionCookie(): Promise<void> {
    (await cookies()).set(cookieName, "", { ...sessionCookieOptions(secure), maxAge: 0 });
  }

  /** Revoke the current session row and drop the cookie. */
  async function signOut(): Promise<void> {
    const jar = await cookies();
    const token = jar.get(cookieName)?.value;
    if (token) await withService((tx) => auth.revokeSession(tx, token)).catch(() => {});
    await clearSessionCookie();
  }

  /** Run as the signed-in person; redirects to `/` when nobody is. */
  async function asMe<T>(fn: (tx: Tx, me: Principal) => Promise<T>): Promise<T> {
    const me = await requirePrincipal();
    return withActor({ identityId: me.identity.id }, (tx) => fn(tx, me));
  }

  /** Run as whoever is here — a person or an anonymous visitor (optionally with a share token). */
  async function asVisitor<T>(fn: (tx: Tx, me: Principal | null, actor: Actor) => Promise<T>, shareHash?: string | null): Promise<T> {
    const me = await currentPrincipal();
    const actor: Actor = { identityId: me?.identity.id ?? null, shareHash: shareHash ?? null };
    return withActor(actor, (tx) => fn(tx, me, actor));
  }

  /** The origin of this request, for links we hand out (reset, invite, share). */
  async function origin(): Promise<string> {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return { app, cookieName, currentPrincipal, requirePrincipal, clientInfo, setSessionCookie, clearSessionCookie, signOut, asMe, asVisitor, origin };
}

export type AppKit = ReturnType<typeof createAppKit>;

/* ------------------------------ form helpers ----------------------------- */

/** Redirect back to a page with the record's one-line error convention. */
export function fail(path: string, message: string, params: Record<string, string> = {}): never {
  const u = new URLSearchParams({ ...params, error: message });
  redirect(`${path}${path.includes("?") ? "&" : "?"}${u.toString()}`);
}

/** Server actions redirect; Next implements redirect() by throwing. Let it through, turn everything else into a message. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  const err = e as Error & { cause?: Error };
  const msg = err?.message ?? String(e);
  if (/row-level security|violates row-level/i.test(`${msg} ${err?.cause?.message ?? ""}`)) return "You do not have permission to do that";
  if (/Failed query/.test(msg)) return err.cause?.message?.replace(/^.*?:\s*/, "") ?? "Something went wrong";
  return msg;
}

export const str = (fd: FormData, name: string): string => String(fd.get(name) ?? "").trim();
export const optStr = (fd: FormData, name: string): string | null => str(fd, name) || null;
export const bool = (fd: FormData, name: string): boolean => fd.get(name) === "on" || fd.get(name) === "true";
export const num = (fd: FormData, name: string): number | null => {
  const v = str(fd, name).replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const cents = (fd: FormData, name: string): number | null => {
  const n = num(fd, name);
  return n == null ? null : Math.round(n * 100);
};

/* --------------------------- property view logging ----------------------- */

/**
 * Resolve how the actor reaches a property and log the look if they are not
 * its owner. Returns null when they cannot see it at all. Call this once per
 * property page, before rendering.
 */
export async function viewProperty(
  tx: Tx,
  propertyId: string,
  actor: Actor,
  opts: { app: HomefaxApp; path: string; orgId?: string | null },
): Promise<{ scope: Scope; via: AccessVia; orgId: string | null } | null> {
  const r = await access.reach(tx, propertyId, actor);
  if (!r) return null;
  await access.logAccess(tx, {
    propertyId,
    viewerIdentityId: actor.identityId,
    viewerOrgId: opts.orgId ?? r.orgId ?? null,
    via: r.via,
    scope: r.scope,
    app: opts.app,
    path: opts.path,
    shareLinkId: r.shareLinkId ?? null,
  });
  return { scope: r.scope, via: r.via, orgId: r.orgId ?? null };
}

export { SESSION_COOKIE };
