/**
 * Accounts layer tests — pure store functions against the file backend.
 *
 * DATABASE_URL must NOT be set when running these tests. tsx does not load
 * .env files, so running `npm test` from a plain shell is safe.
 *
 *   npm test
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// Point at a throw-away directory before any accounts/store code evaluates
// process.cwd(). Both modules compute their file path lazily via getDataFile(),
// so changing the working directory here is sufficient.
const originalCwd = process.cwd();
const tmpDir = mkdtempSync(path.join(tmpdir(), "homefax-accounts-test-"));
process.chdir(tmpDir);

// Now import the store functions (they will compute their paths from tmpDir)
import {
  addMembership,
  canAccessRecord,
  claimLegacyRecords,
  createAssignment,
  createHire,
  createOrg,
  createUser,
  getOrg,
  getUser,
  getUserByEmail,
  getUserByHandle,
  grantProjectAccess,
  listAssignmentsForRecord,
  listIncomingHires,
  listMembers,
  listOrgsForUser,
  listPublicProfiles,
  updateOrg,
  updateUser,
} from "../src/lib/accounts";
import { createRecord } from "../src/lib/store";
import { hashPassword } from "../src/lib/auth";

after(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

/* -------------------------------- helpers -------------------------------- */

let userCounter = 0;
function uniqueEmail(): string {
  return `test${++userCounter}@example.com`;
}
function uniqueHandle(): string {
  return `user${userCounter}`;
}

async function makeUser(overrides: { email?: string; handle?: string; name?: string } = {}) {
  return createUser({
    email: overrides.email ?? uniqueEmail(),
    passwordHash: hashPassword("password123"),
    name: overrides.name ?? "Test User",
    handle: overrides.handle ?? uniqueHandle(),
  });
}

/* --------------------------------- tests --------------------------------- */

test("signup → duplicate email rejected", async () => {
  const email = uniqueEmail();
  await makeUser({ email, handle: `aaa${userCounter}` });
  await assert.rejects(
    () => makeUser({ email, handle: `bbb${userCounter}` }),
    /email already has an account/i,
  );
});

test("signup → duplicate handle rejected", async () => {
  const handle = `handle${userCounter + 1}`;
  await makeUser({ handle });
  await assert.rejects(
    () => makeUser({ handle }),
    /handle is taken/i,
  );
});

test("org creation: owner membership and hfxKey shape", async () => {
  const user = await makeUser();
  const org = await createOrg({ name: "Acme Roofing", ownerUserId: user.id });

  assert.ok(org.id, "org has an id");
  assert.equal(org.ownerUserId, user.id);
  assert.match(org.hfxKey, /^hfx_[0-9a-f]{24}$/);
  assert.ok(org.slug.startsWith("acme-roofing"));

  const members = await listMembers(org.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].membership.role, "owner");
  assert.equal(members[0].membership.userId, user.id);
  // Public user must not leak email or passwordHash
  assert.ok(!("email" in members[0].user), "email must not appear in PublicUser");
  assert.ok(!("passwordHash" in members[0].user), "passwordHash must not appear in PublicUser");
});

test("addMembership + listMembers strips private fields", async () => {
  const owner = await makeUser();
  const member = await makeUser();
  const org = await createOrg({ name: "Builder Co", ownerUserId: owner.id });
  await addMembership({ orgId: org.id, userId: member.id, role: "member", title: "Crew lead" });

  const members = await listMembers(org.id);
  assert.equal(members.length, 2);
  for (const m of members) {
    assert.ok(!("email" in m.user));
    assert.ok(!("passwordHash" in m.user));
  }
  const added = members.find((m) => m.membership.userId === member.id);
  assert.ok(added, "added member appears in list");
  assert.equal(added!.membership.title, "Crew lead");
});

test("claimLegacyRecords moves only matching+unowned records and is idempotent", async () => {
  const user = await makeUser();
  const org = await createOrg({ name: "Legacy Plumbing", ownerUserId: user.id });

  const keyId = "legacykey001";
  const otherKeyId = "otherkey002";

  // Create records: two with our key (unowned), one with our key but already owned, one with another key
  const r1 = await createRecord({ id: "lr1", slug: "lr-addr-1", address: "1 Main St", keyId });
  const r2 = await createRecord({ id: "lr2", slug: "lr-addr-2", address: "2 Main St", keyId });
  await createRecord({ id: "lr3", slug: "lr-addr-3", address: "3 Main St", keyId, orgId: "already-owned" });
  await createRecord({ id: "lr4", slug: "lr-addr-4", address: "4 Main St", keyId: otherKeyId });

  const count = await claimLegacyRecords(org.id, keyId);
  assert.equal(count, 2, "only unowned records with matching keyId are claimed");

  const count2 = await claimLegacyRecords(org.id, keyId);
  assert.equal(count2, 0, "idempotent: no records to claim a second time");

  // The org now has access to r1 and r2
  const accessible = new Set(await import("../src/lib/accounts").then((m) => m.accessibleRecordIds(org.id)));
  assert.ok(accessible.has(r1.id), "claimed record r1 is accessible");
  assert.ok(accessible.has(r2.id), "claimed record r2 is accessible");
  assert.ok(!accessible.has("lr3"), "pre-owned record is not claimed");
  assert.ok(!accessible.has("lr4"), "other-key record is not claimed");
});

test("assignment to user makes canAccessRecord true", async () => {
  const owner = await makeUser();
  const assignee = await makeUser();
  const org = await createOrg({ name: "Frame Co", ownerUserId: owner.id });

  const record = await createRecord({
    id: "asgn-rec1",
    slug: "asgn-addr-1",
    address: "5 Oak Ave",
    orgId: org.id,
  });
  await grantProjectAccess({ recordId: record.id, orgId: org.id, role: "owner" });

  // Assignee has no access yet
  assert.equal(await canAccessRecord(assignee.id, record.id), false);

  await createAssignment({
    recordId: record.id,
    assigneeUserId: assignee.id,
    task: "Install framing",
    assignedByUserId: owner.id,
  });

  assert.equal(await canAccessRecord(assignee.id, record.id), true);
});

test("hire to org visible in listIncomingHires for an admin", async () => {
  const fromOwner = await makeUser();
  const toOwner = await makeUser();
  const toAdmin = await makeUser();
  const toMember = await makeUser();

  const fromOrg = await createOrg({ name: "Hiring Co", ownerUserId: fromOwner.id });
  const toOrg = await createOrg({ name: "Hired Co", ownerUserId: toOwner.id });
  await addMembership({ orgId: toOrg.id, userId: toAdmin.id, role: "admin" });
  await addMembership({ orgId: toOrg.id, userId: toMember.id, role: "member" });

  await createHire({
    fromOrgId: fromOrg.id,
    toOrgId: toOrg.id,
    task: "Tile bathroom",
    createdByUserId: fromOwner.id,
  });

  const ownerHires = await listIncomingHires(toOwner.id);
  assert.equal(ownerHires.length, 1, "org owner sees the hire");

  const adminHires = await listIncomingHires(toAdmin.id);
  assert.equal(adminHires.length, 1, "org admin sees the hire");

  const memberHires = await listIncomingHires(toMember.id);
  assert.equal(memberHires.length, 0, "regular member does not see org-addressed hires");
});

test("accept-with-record creates the assignment", async () => {
  const fromOwner = await makeUser();
  const toUser = await makeUser();

  const fromOrg = await createOrg({ name: "GC Corp", ownerUserId: fromOwner.id });
  const record = await createRecord({
    id: "hire-rec1",
    slug: "hire-addr-1",
    address: "7 Pine Rd",
    orgId: fromOrg.id,
  });
  await grantProjectAccess({ recordId: record.id, orgId: fromOrg.id, role: "owner" });

  const hire = await createHire({
    fromOrgId: fromOrg.id,
    toUserId: toUser.id,
    task: "Plumbing rough-in",
    recordId: record.id,
    createdByUserId: fromOwner.id,
  });

  // Accept creates assignment
  const { setHireStatus: setStatus } = await import("../src/lib/accounts");
  await setStatus(hire.id, "accepted");
  await createAssignment({
    recordId: record.id,
    assigneeUserId: toUser.id,
    task: hire.task,
    assignedByUserId: toUser.id,
  });

  const assignments = await listAssignmentsForRecord(record.id);
  assert.ok(assignments.some((a) => a.assigneeUserId === toUser.id), "assignment created");

  // canAccessRecord is now true for the assigned user
  assert.equal(await canAccessRecord(toUser.id, record.id), true);
});

test("listPublicProfiles never leaks email, passwordHash, or hfxKey", async () => {
  const user = await makeUser();
  await updateUser(user.id, { isPublic: true });

  const owner = await makeUser();
  const org = await createOrg({ name: "Public LLC", ownerUserId: owner.id });
  await updateOrg(org.id, { isPublic: true });

  const { users, orgs } = await listPublicProfiles();

  // Must have at least our public user and org
  const pubUser = users.find((u) => u.id === user.id);
  assert.ok(pubUser, "public user appears in list");
  assert.ok(!("email" in pubUser!), "email must not appear");
  assert.ok(!("passwordHash" in pubUser!), "passwordHash must not appear");

  const pubOrg = orgs.find((o) => o.id === org.id);
  assert.ok(pubOrg, "public org appears in list");
  assert.ok(!("hfxKey" in pubOrg!), "hfxKey must not appear");
  assert.ok(!("claimedKeyId" in pubOrg!), "claimedKeyId must not appear");
  assert.ok(!("ownerUserId" in pubOrg!), "ownerUserId must not appear");

  // Confirm non-public users/orgs are absent
  const nonPublicUser = await makeUser();
  assert.ok(!users.some((u) => u.id === nonPublicUser.id), "non-public user must not appear");
});
