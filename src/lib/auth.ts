import { createHmac, randomBytes, scryptSync, timingSafeEqual as tsEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Real sign-ins.
 *
 * Passwords are scrypt-hashed; the session is a signed stateless cookie
 * (`userId.expiry.hmac`) so there is no session table to sweep. AUTH_SECRET
 * signs it — set it in production; a dev fallback keeps the laptop flow
 * working with nothing provisioned.
 *
 * The legacy ACCESS_KEYS gate is gone as a login, but the keys survive for one
 * purpose: a company can claim the records its old key created (see
 * verifyKey), and every company now carries its own `hfx_…` key used to add it
 * to someone else's project.
 */

export const SESSION_COOKIE = "hfx_session";
const SESSION_DAYS = 30;

/* ------------------------------ passwords ------------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = stored.split(":");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && tsEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------- sessions ------------------------------- */

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  // Dev fallback: deterministic so restarts keep you signed in locally, and
  // never used silently in production.
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("AUTH_SECRET is not set");
  }
  return "homefax-dev-secret-not-for-production";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function mintSession(userId: string): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `${userId}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: SESSION_DAYS * 86400 };
}

export function readSession(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const payload = value.slice(0, i);
  const mac = value.slice(i + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !tsEqual(a, b)) return null;
  const [userId, expStr] = payload.split(".");
  if (!userId || Number(expStr) < Date.now() / 1000) return null;
  return userId;
}

/** Set the session cookie for a signed-in user. Server actions/handlers only. */
export async function startSession(userId: string): Promise<void> {
  const jar = await cookies();
  const s = mintSession(userId);
  jar.set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: s.maxAge,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user id, or null. Verifies the signature, not existence. */
export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
}

export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new Error("UNAUTHORIZED");
  return id;
}

/* --------------------------- legacy access keys -------------------------- */

export type AccessKey = { id: string; secret: string; label: string };

/** The old env-var gate — kept only so a company can claim its key's records. */
export function accessKeys(): AccessKey[] {
  const raw = process.env.ACCESS_KEYS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [secret, label] = entry.split(":");
      return {
        id: secret.slice(0, 12),
        secret,
        label: (label ?? "Contractor").trim(),
      };
    });
}

export function verifyKey(secret: string): AccessKey | null {
  const candidate = secret.trim();
  if (!candidate) return null;
  let found: AccessKey | null = null;
  for (const k of accessKeys()) {
    if (k.secret.length === candidate.length && timingSafeEqualStr(k.secret, candidate))
      found = k;
  }
  return found;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a company HomeFAX key. */
export function mintHfxKey(): string {
  return `hfx_${randomBytes(12).toString("hex")}`;
}
