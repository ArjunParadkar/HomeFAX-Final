import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Column-level encryption for the few fields that are sensitive even inside the
 * database (phone numbers, policy and loan references). AES-256-GCM with a
 * random nonce; the ciphertext is self-describing so the key can be rotated
 * (`v1` → `v2`) without a stop-the-world migration.
 *
 * The key is `PII_ENCRYPTION_KEY`: 32 bytes, base64. Without it the app refuses
 * to store an encrypted field rather than silently storing plaintext.
 */
const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("PII_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export const fieldCryptoConfigured = (): boolean => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptField(stored: string): string {
  const [version, ivB64, ctB64, tagB64] = stored.split(":");
  if (version !== VERSION) throw new Error(`Unknown field encryption version ${version}`);
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Generate a key for an environment file. */
export function generateFieldKey(): string {
  return randomBytes(32).toString("base64");
}
