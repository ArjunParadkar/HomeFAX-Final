/**
 * Operator recovery: issue a one-time password reset link for any account,
 * including a company owner (the app never lets the UI reset an owner).
 *
 *   npx tsx scripts/issue-reset-link.ts someone@example.com [https://homefax-final.vercel.app]
 *
 * Reads DATABASE_URL (and friends) from the environment, falling back to this
 * app's .env.local. Prints the link; nothing is stored in clear. The link works
 * once and expires after an hour.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auth, closePool, withService } from "@homefax/db";

function loadEnvLocal(): void {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  const [email, originArg] = process.argv.slice(2);
  if (!email) {
    console.error("usage: npx tsx scripts/issue-reset-link.ts <email> [origin]");
    process.exit(2);
  }
  loadEnvLocal();
  const origin = (originArg ?? "https://homefax-final.vercel.app").replace(/\/$/, "");
  const out = await withService(async (tx) => {
    const identity = await auth.getIdentityByEmail(tx, email);
    if (!identity) return null;
    const { token, expiresAt } = await auth.createPasswordReset(tx, { identityId: identity.id, issuedBy: null });
    return { identity, token, expiresAt };
  });
  if (!out) {
    console.error(`No account for ${email}`);
    process.exit(1);
  }
  console.log(`${origin}/reset?token=${encodeURIComponent(out.token)}`);
  console.error(`for ${out.identity.email} — one use, expires ${out.expiresAt.toISOString()} (${auth.RESET_TOKEN_MINUTES} min)`);
  await closePool();
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
