/**
 * Operator recovery: issue a one-time password reset link for any account,
 * including a company owner (the app never lets the UI reset an owner).
 *
 *   DATABASE_URL=… npx tsx scripts/issue-reset-link.ts someone@example.com [https://homefax-final.vercel.app]
 *
 * Without DATABASE_URL it acts on the local .data/store.json. Prints the link;
 * nothing is stored in clear. The link works once and expires after an hour.
 */
import { createPasswordReset, getUserByEmail } from "../src/lib/accounts";
import { RESET_TOKEN_MINUTES } from "../src/lib/auth";

async function main() {
  const [email, originArg] = process.argv.slice(2);
  if (!email) {
    console.error("usage: npx tsx scripts/issue-reset-link.ts <email> [origin]");
    process.exit(2);
  }
  const origin = (originArg ?? "https://homefax-final.vercel.app").replace(/\/$/, "");
  const user = await getUserByEmail(email.toLowerCase().trim());
  if (!user) {
    console.error(`No account for ${email}`);
    process.exit(1);
  }
  const { token, expiresAt } = await createPasswordReset({ userId: user.id, issuedByUserId: null });
  console.log(`${origin}/reset?token=${encodeURIComponent(token)}`);
  console.error(`for ${user.name} (@${user.handle}) — one use, expires ${expiresAt} (${RESET_TOKEN_MINUTES} min)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
