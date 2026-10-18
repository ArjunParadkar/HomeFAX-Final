import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestDatabase } from "./helpers";

before(async () => {
  await resetTestDatabase("auth");
});

test("sign up, sign in, resolve session, RLS hides other identities", async () => {
  const { withActor, withService, closePool } = await import("../src/client");
  const auth = await import("../src/repos/auth");
  const { identities } = await import("../src/schema/auth");
  after(() => closePool());

  const a = await withService((tx) => auth.signUp(tx, { email: "A@Example.com", password: "a long passphrase 1", name: "Alice Mason", app: "contractor" }));
  const b = await withService((tx) => auth.signUp(tx, { email: "b@example.com", password: "a long passphrase 2", name: "Bob Reyes", app: "homeowner" }));
  assert.equal(a.principal.identity.email, "a@example.com");
  assert.equal(a.principal.profile.handle, "alice-mason");

  const bad = await withService((tx) => auth.signIn(tx, { email: "a@example.com", password: "nope nope nope", app: "contractor", ip: "10.0.0.1" }));
  assert.equal(bad.ok, false);
  const good = await withService((tx) => auth.signIn(tx, { email: "a@example.com", password: "a long passphrase 1", app: "contractor", ip: "10.0.0.1" }));
  assert.ok(good.ok);

  const me = await withService((tx) => auth.resolveSession(tx, good.ok ? good.token : "", "contractor"));
  assert.equal(me?.identity.id, a.principal.identity.id);
  const wrongApp = await withService((tx) => auth.resolveSession(tx, good.ok ? good.token : "", "homeowner"));
  assert.equal(wrongApp, null);

  // As Alice: can see herself, cannot see Bob.
  const seen = await withActor({ identityId: a.principal.identity.id }, (tx) => tx.select({ id: identities.id }).from(identities));
  assert.deepEqual(seen.map((r) => r.id), [a.principal.identity.id]);
  // Anonymous sees nothing.
  const anon = await withActor({ identityId: null }, (tx) => tx.select({ id: identities.id }).from(identities));
  assert.equal(anon.length, 0);
  // Nobody but the service reads credentials.
  const { credentials } = await import("../src/schema/auth");
  const creds = await withActor({ identityId: a.principal.identity.id }, (tx) => tx.select().from(credentials));
  assert.equal(creds.length, 0);
  void b;
});

test("lockout after repeated failures", async () => {
  const { withService } = await import("../src/client");
  const auth = await import("../src/repos/auth");
  await withService((tx) => auth.signUp(tx, { email: "lock@example.com", password: "a long passphrase 3", name: "Lock Me", app: "admin" }));
  for (let i = 0; i < 5; i++) {
    await withService((tx) => auth.signIn(tx, { email: "lock@example.com", password: "wrong wrong wrong", app: "admin", ip: "10.0.0.9" }));
  }
  const r = await withService((tx) => auth.signIn(tx, { email: "lock@example.com", password: "a long passphrase 3", app: "admin", ip: "10.0.0.9" }));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.reason, "locked");
});

test("password reset burns the token and revokes sessions", async () => {
  const { withService } = await import("../src/client");
  const auth = await import("../src/repos/auth");
  const s = await withService((tx) => auth.signUp(tx, { email: "r@example.com", password: "a long passphrase 4", name: "Reset Me", app: "homeowner" }));
  const { token } = await withService((tx) => auth.createPasswordReset(tx, { identityId: s.principal.identity.id }));
  await withService((tx) => auth.consumePasswordReset(tx, token, "a brand new passphrase 5"));
  assert.equal(await withService((tx) => auth.findPasswordReset(tx, token)), null);
  assert.equal(await withService((tx) => auth.resolveSession(tx, s.token, "homeowner")), null);
  const r = await withService((tx) => auth.signIn(tx, { email: "r@example.com", password: "a brand new passphrase 5", app: "homeowner" }));
  assert.ok(r.ok);
});
