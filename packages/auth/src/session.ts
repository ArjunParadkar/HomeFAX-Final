/**
 * Sessions are server-side rows (auth.sessions) keyed by the SHA-256 of an
 * opaque token the browser holds in an httpOnly cookie. Revocable, per-app,
 * and sliding: each use extends the expiry up to an absolute ceiling.
 */
export const SESSION_IDLE_DAYS = 14;
export const SESSION_ABSOLUTE_DAYS = 60;

export type HomefaxApp = "contractor" | "homeowner" | "admin";

export const SESSION_COOKIE: Record<HomefaxApp, string> = {
  contractor: "hfx_session",
  homeowner: "hfx_owner_session",
  admin: "hfx_admin_session",
};

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_ABSOLUTE_DAYS * 86400,
  };
}

export function sessionExpiry(createdAt: Date, lastSeenAt: Date): Date {
  const idle = lastSeenAt.getTime() + SESSION_IDLE_DAYS * 86400_000;
  const absolute = createdAt.getTime() + SESSION_ABSOLUTE_DAYS * 86400_000;
  return new Date(Math.min(idle, absolute));
}
