/**
 * The pre-accounts access keys.
 *
 * Before sign-ins existed, a contractor got into the app with one of the
 * secrets in ACCESS_KEYS. Those keys no longer open anything; they survive for
 * exactly one purpose — a company can prove it held a key and claim the records
 * that key created (`records.claimLegacyRecords`).
 *
 * Format: `ACCESS_KEYS="secret:Label,secret2:Label2"`.
 */

export type AccessKey = { id: string; secret: string; label: string };

export function accessKeys(): AccessKey[] {
  const raw = process.env.ACCESS_KEYS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [secret, label] = entry.split(":");
      return {
        // The id is what the old records were stamped with (build.records.legacy_key_id).
        id: secret.slice(0, 12),
        secret,
        label: (label ?? "Contractor").trim(),
      };
    });
}

/** The key behind a secret, or null. Constant-time per candidate so a wrong key costs the same as a right one. */
export function verifyKey(secret: string): AccessKey | null {
  const candidate = secret.trim();
  if (!candidate) return null;
  let found: AccessKey | null = null;
  for (const k of accessKeys()) {
    if (k.secret.length === candidate.length && timingSafeEqualStr(k.secret, candidate)) found = k;
  }
  return found;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
