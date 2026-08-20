import { cookies } from "next/headers";

export const KEY_COOKIE = "hfx_key";

export type AccessKey = { id: string; secret: string; label: string };

/**
 * Access keys live in one env var so a new contractor can be added without a
 * deploy of anything but config:
 *
 *   ACCESS_KEYS="sk-abc123:Paradkar Builders,sk-def456:Demo"
 *
 * The key id is the hash-free prefix before the first dash-group; it scopes
 * records so two contractors sharing a deployment never see each other's homes.
 */
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

export function authConfigured(): boolean {
  return accessKeys().length > 0;
}

export function verifyKey(secret: string): AccessKey | null {
  const candidate = secret.trim();
  if (!candidate) return null;
  // Constant-time-ish: compare against every key rather than short-circuiting.
  let found: AccessKey | null = null;
  for (const k of accessKeys()) {
    if (timingSafeEqual(k.secret, candidate)) found = k;
  }
  return found;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The signed-in key, or null. Server components and route handlers only. */
export async function currentKey(): Promise<AccessKey | null> {
  const jar = await cookies();
  const secret = jar.get(KEY_COOKIE)?.value;
  if (!secret) return null;
  return verifyKey(secret);
}

export async function requireKey(): Promise<AccessKey> {
  const key = await currentKey();
  if (!key) throw new Error("UNAUTHORIZED");
  return key;
}
