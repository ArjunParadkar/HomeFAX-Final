/**
 * Load the demo world into DATABASE_URL (see src/seed-world.ts).
 *
 *   npm run db:seed
 *
 * Idempotent: re-running adds nothing. Demo accounts all share one password,
 * printed below. Never run against a database with real customers.
 */
import { loadEnv } from "../src/env";
loadEnv();
if (!process.env.PII_ENCRYPTION_KEY) {
  // Seed references (loan numbers, policy numbers) are encrypted at rest.
  process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 42).toString("base64");
  console.warn("PII_ENCRYPTION_KEY not set — using the well-known DEMO key. Set a real one before production.");
}
const { seedWorld, DEMO_PASSWORD, DEMO_PEOPLE } = await import("../src/seed-world");
const { closePool } = await import("../src/client");
try {
  const world = await seedWorld({ log: (s) => console.log("  " + s) });
  console.log("\nDemo accounts (password for all: %s)", DEMO_PASSWORD);
  for (const p of Object.values(DEMO_PEOPLE)) console.log(`  ${p.email.padEnd(24)} ${p.name}`);
  if (Object.keys(world.claimCodes).length) {
    console.log("\nUnclaimed houses (homeowner claim codes):");
    for (const [k, code] of Object.entries(world.claimCodes)) console.log(`  ${k.padEnd(10)} ${code}`);
  }
  if (world.shareTokens.maple) console.log(`\nPublic report link token for 7 Maple Ct: ${world.shareTokens.maple}`);
} finally {
  await closePool();
}
