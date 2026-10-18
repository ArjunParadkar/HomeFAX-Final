import { cookies } from "next/headers";

/**
 * Secrets the app hands over rather than mails — a reset link, a claim code —
 * are shown exactly once. The action that mints one puts it in a short-lived
 * httpOnly cookie scoped to the page that shows it; the page reads it, and a
 * "Done" button clears it. The database only ever holds the hash.
 */

export const RESET_LINK_COOKIE = "hfx_reset_link";
export const CLAIM_CODE_COOKIE = "hfx_claim_code";

export type IssuedResetLink = {
  membershipId: string;
  userName: string;
  link: string;
  expiresAt: string;
};

export type IssuedClaimCode = {
  /** The record page the code belongs to. */
  slug: string;
  code: string;
  expiresAt: string;
};

export async function readShowOnce<T extends { expiresAt: string }>(name: string): Promise<T | null> {
  const raw = (await cookies()).get(name)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T;
    if (!parsed.expiresAt || Date.parse(parsed.expiresAt) < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeShowOnce(name: string, path: string, value: { expiresAt: string }, maxAgeSeconds: number): Promise<void> {
  (await cookies()).set(name, JSON.stringify(value), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path,
    maxAge: maxAgeSeconds,
  });
}

export async function clearShowOnce(name: string, path: string): Promise<void> {
  (await cookies()).set(name, "", { path, maxAge: 0 });
}
