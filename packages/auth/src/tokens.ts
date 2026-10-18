import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque bearer tokens — sessions, reset links, invitations, share links, API
 * keys. The database only ever stores the SHA-256 of a token; the token itself
 * exists in a cookie or a link and nowhere else.
 */
export function mintToken(bytes = 32): { token: string; tokenHash: string } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A company's HomeFAX key — quoted to add the company to someone's project. */
export function mintHfxKey(): string {
  return `hfx_${randomBytes(12).toString("hex")}`;
}

/** Eight characters a homeowner can type off a card. No ambiguous glyphs. */
export function mintClaimCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normalizeClaimCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
}
