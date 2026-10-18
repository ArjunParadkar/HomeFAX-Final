import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { test } from "node:test";
import {
  constantTimeEqual,
  decryptField,
  encryptField,
  generateFieldKey,
  hashPassword,
  hashToken,
  lockoutFor,
  mintClaimCode,
  mintToken,
  normalizeClaimCode,
  passwordHashIsStale,
  passwordProblem,
  verifyPassword,
  MAX_FAILURES_PER_EMAIL,
} from "../src/index";

test("password round-trips and rejects the wrong one", () => {
  const h = hashPassword("correct horse battery");
  assert.ok(verifyPassword("correct horse battery", h));
  assert.ok(!verifyPassword("correct horse batteries", h));
  assert.ok(!verifyPassword("x", "garbage"));
});

test("legacy N=16384 hashes still verify and are flagged stale", () => {
  const legacy =
    "scrypt:16384:8:1:" + Buffer.alloc(16, 1).toString("base64") + ":" +
    Buffer.from(scryptSync("pw-legacy-1", Buffer.alloc(16, 1), 32, { N: 16384, r: 8, p: 1 })).toString("base64");
  assert.ok(verifyPassword("pw-legacy-1", legacy));
  assert.ok(passwordHashIsStale(legacy));
  assert.ok(!passwordHashIsStale(hashPassword("fresh-password-1")));
});

test("password policy", () => {
  assert.match(passwordProblem("short") ?? "", /at least/);
  assert.match(passwordProblem("password123") ?? "", /breach/);
  assert.match(passwordProblem("aaaaaaaaaaaa") ?? "", /repeated/);
  assert.equal(passwordProblem("a perfectly fine passphrase"), null);
});

test("tokens hash deterministically and compare in constant time", () => {
  const { token, tokenHash } = mintToken();
  assert.equal(hashToken(token), tokenHash);
  assert.ok(constantTimeEqual(tokenHash, hashToken(` ${token} `)));
  assert.ok(!constantTimeEqual(tokenHash, hashToken("other")));
});

test("claim codes are 8 unambiguous characters", () => {
  const code = mintClaimCode();
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  assert.equal(normalizeClaimCode(code.toLowerCase().replace("-", " ")), code);
});

test("field encryption round-trips and tampering fails", () => {
  process.env.PII_ENCRYPTION_KEY = generateFieldKey();
  const ct = encryptField("+1 479 555 0100");
  assert.equal(decryptField(ct), "+1 479 555 0100");
  const parts = ct.split(":");
  parts[2] = Buffer.from("tampered!!").toString("base64");
  assert.throws(() => decryptField(parts.join(":")));
});

test("lockout after five failures inside the window", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const recent = Array.from({ length: MAX_FAILURES_PER_EMAIL }, (_, i) => new Date(now.getTime() - i * 60_000));
  const l = lockoutFor(recent, MAX_FAILURES_PER_EMAIL, now);
  assert.ok(l.locked);
  assert.ok(l.retryAfterMs > 0);
  const old = recent.map((d) => new Date(d.getTime() - 60 * 60_000));
  assert.ok(!lockoutFor(old, MAX_FAILURES_PER_EMAIL, now).locked);
});
