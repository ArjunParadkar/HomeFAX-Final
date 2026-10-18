import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Passwords are scrypt-hashed with a per-password salt. The stored string is
 * self-describing — `scrypt:N:r:p:saltB64:hashB64` — so the cost can be raised
 * later and old hashes still verify (and get re-hashed on next sign-in).
 */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = stored.split(":");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashB64, "base64");
    const n = Number(N);
    const rr = Number(r);
    const actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
      N: n,
      r: rr,
      p: Number(p),
      maxmem: 128 * n * rr * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** True when the hash was made with weaker parameters than we use today. */
export function passwordHashIsStale(stored: string): boolean {
  const [scheme, N] = stored.split(":");
  return scheme !== "scrypt" || Number(N) < SCRYPT.N;
}

/** Minimum length for any password set from now on. Existing shorter passwords keep working. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

/* The handful of passwords that account for most credential-stuffing hits. */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd",
  "1234567890", "12345678910", "qwertyuiop", "qwerty1234", "iloveyou12", "letmein123",
  "welcome123", "admin12345", "homefax123", "contractor", "sunshine12", "football12",
  "baseball12", "superman12", "trustno1!", "monkey1234", "dragon1234", "1q2w3e4r5t",
]);

/** The reason a candidate password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  if (COMMON.has(password.toLowerCase())) return "That password is on every breach list — pick another";
  if (/^(.)\1+$/.test(password)) return "A password cannot be one repeated character";
  return null;
}
