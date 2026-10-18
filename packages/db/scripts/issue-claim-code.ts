/**
 * Operator tool: print a fresh homeowner claim code for a property.
 *
 *   npx tsx packages/db/scripts/issue-claim-code.ts <property slug>
 */
import { loadEnv } from "../src/env";
loadEnv();
const slug = process.argv[2];
if (!slug) {
  console.error("usage: issue-claim-code <property slug>");
  process.exit(1);
}
const db = await import("../src/index");
try {
  const out = await db.withService(async (tx) => {
    const p = await db.properties.getPropertyBySlug(tx, slug);
    if (!p) throw new Error(`No property with slug ${slug}`);
    const { code } = await db.properties.createOwnerInvite(tx, { propertyId: p.id, invitedBy: p.createdBy });
    return { code, address: `${p.line1}, ${p.city}, ${p.state} ${p.postalCode}` };
  });
  console.log(`${out.address}\nclaim code: ${out.code} (valid 30 days, one use)`);
} finally {
  await db.closePool();
}
