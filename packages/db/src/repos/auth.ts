import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  hashPassword,
  hashToken,
  lockoutFor,
  mintToken,
  passwordHashIsStale,
  passwordProblem,
  sessionExpiry,
  verifyPassword,
  ATTEMPT_WINDOW_MS,
  MAX_FAILURES_PER_EMAIL,
  MAX_FAILURES_PER_IP,
  type HomefaxApp,
} from "@homefax/auth";
import type { Tx } from "../client";
import { newId, slugify } from "../ids";
import { credentials, identities, loginAttempts, passwordResets, sessions } from "../schema/auth";
import { profiles, type Profile } from "../schema/people";
import type { Identity, Session } from "../schema/auth";

/**
 * Sign-up, sign-in, sessions, resets. Every function here expects a SERVICE
 * transaction (withService) — these are the operations that happen before
 * there is an actor, or that touch credentials, which no actor may read.
 */

export type Principal = { identity: Identity; profile: Profile; session: Session };

export const RESET_TOKEN_MINUTES = 60;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getIdentity(tx: Tx, id: string): Promise<Identity | null> {
  const rows = await tx.select().from(identities).where(eq(identities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getIdentityByEmail(tx: Tx, email: string): Promise<Identity | null> {
  const rows = await tx.select().from(identities).where(eq(identities.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}

async function uniqueHandle(tx: Tx, wanted: string): Promise<string> {
  let base = slugify(wanted, 24);
  if (base.length < 3) base = base.padEnd(3, "0");
  let handle = base;
  for (let i = 0; i < 20; i++) {
    const clash = await tx.select({ id: profiles.identityId }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (clash.length === 0) return handle;
    handle = `${base.slice(0, 19)}-${newId().slice(0, 4).toLowerCase()}`;
  }
  throw new Error("Could not find a free handle");
}

export async function signUp(
  tx: Tx,
  input: {
    email: string;
    password: string;
    name: string;
    handle?: string;
    headline?: string;
    app: HomefaxApp;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{ principal: Principal; token: string }> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");

  if (await getIdentityByEmail(tx, email)) throw new Error("That email already has an account");

  const handle = input.handle
    ? input.handle.toLowerCase().trim()
    : await uniqueHandle(tx, name);
  if (!/^[a-z0-9-]{3,24}$/.test(handle)) {
    throw new Error("Handle must be 3–24 lowercase letters, numbers, or hyphens");
  }
  if (input.handle) {
    const clash = await tx.select({ id: profiles.identityId }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (clash.length) throw new Error("That handle is taken");
  }

  const id = newId();
  const [identity] = await tx.insert(identities).values({ id, email, lastSignInAt: new Date() }).returning();
  await tx.insert(credentials).values({ identityId: id, passwordHash: hashPassword(input.password) });
  const [profile] = await tx
    .insert(profiles)
    .values({ identityId: id, name, handle, headline: input.headline?.trim() || null })
    .returning();
  const { session, token } = await startSession(tx, { identityId: id, app: input.app, ip: input.ip, userAgent: input.userAgent });
  return { principal: { identity, profile, session }, token };
}

export type SignInResult =
  | { ok: true; principal: Principal; token: string }
  | { ok: false; reason: "locked" | "bad_credentials" | "suspended"; retryAfterMs?: number };

export async function signIn(
  tx: Tx,
  input: { email: string; password: string; app: HomefaxApp; ip?: string | null; userAgent?: string | null },
): Promise<SignInResult> {
  const email = normalizeEmail(input.email);
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);

  const byEmail = await tx
    .select({ at: loginAttempts.at })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.succeeded, false), gt(loginAttempts.at, since)));
  const emailLock = lockoutFor(byEmail.map((r) => r.at), MAX_FAILURES_PER_EMAIL);
  let ipLock = { locked: false, retryAfterMs: 0 };
  if (input.ip) {
    const byIp = await tx
      .select({ at: loginAttempts.at })
      .from(loginAttempts)
      .where(and(sql`${loginAttempts.ip} = ${input.ip}::inet`, eq(loginAttempts.succeeded, false), gt(loginAttempts.at, since)));
    ipLock = lockoutFor(byIp.map((r) => r.at), MAX_FAILURES_PER_IP);
  }
  if (emailLock.locked || ipLock.locked) {
    return { ok: false, reason: "locked", retryAfterMs: Math.max(emailLock.retryAfterMs, ipLock.retryAfterMs) };
  }

  const identity = await getIdentityByEmail(tx, email);
  const cred = identity
    ? (await tx.select().from(credentials).where(eq(credentials.identityId, identity.id)).limit(1))[0]
    : undefined;
  const good = Boolean(identity && cred && verifyPassword(input.password, cred.passwordHash));

  await tx.insert(loginAttempts).values({
    email,
    ip: input.ip ?? null,
    succeeded: good,
    app: input.app,
  });

  if (!good || !identity || !cred) return { ok: false, reason: "bad_credentials" };
  if (identity.status !== "active") return { ok: false, reason: "suspended" };

  if (passwordHashIsStale(cred.passwordHash)) {
    await tx.update(credentials).set({ passwordHash: hashPassword(input.password), rotatedAt: new Date() }).where(eq(credentials.identityId, identity.id));
  }
  await tx.update(identities).set({ lastSignInAt: new Date() }).where(eq(identities.id, identity.id));
  const profile = (await tx.select().from(profiles).where(eq(profiles.identityId, identity.id)).limit(1))[0];
  const { session, token } = await startSession(tx, { identityId: identity.id, app: input.app, ip: input.ip, userAgent: input.userAgent });
  return { ok: true, principal: { identity, profile, session }, token };
}

export async function startSession(
  tx: Tx,
  input: { identityId: string; app: HomefaxApp; ip?: string | null; userAgent?: string | null },
): Promise<{ session: Session; token: string }> {
  const { token, tokenHash } = mintToken();
  const now = new Date();
  const [session] = await tx
    .insert(sessions)
    .values({
      id: newId(),
      tokenHash,
      identityId: input.identityId,
      app: input.app,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      expiresAt: sessionExpiry(now, now),
    })
    .returning();
  return { session, token };
}

const TOUCH_EVERY_MS = 10 * 60 * 1000;

/** The person behind a session cookie, or null. Slides the expiry forward. */
export async function resolveSession(tx: Tx, token: string | undefined, app: HomefaxApp): Promise<Principal | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await tx
    .select({ session: sessions, identity: identities, profile: profiles })
    .from(sessions)
    .innerJoin(identities, eq(identities.id, sessions.identityId))
    .innerJoin(profiles, eq(profiles.identityId, sessions.identityId))
    .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.app, app), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.identity.status !== "active") return null;
  const now = new Date();
  if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await tx
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: sessionExpiry(row.session.createdAt, now) })
      .where(eq(sessions.id, row.session.id));
  }
  return row;
}

export async function revokeSession(tx: Tx, token: string): Promise<void> {
  await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeSessionById(tx: Tx, identityId: string, sessionId: string): Promise<void> {
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), eq(sessions.identityId, identityId)));
}

export async function revokeOtherSessions(tx: Tx, identityId: string, keepSessionId: string): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.identityId, identityId), isNull(sessions.revokedAt), sql`${sessions.id} <> ${keepSessionId}`))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function listSessions(tx: Tx, identityId: string): Promise<Session[]> {
  return tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.identityId, identityId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function changePassword(tx: Tx, identityId: string, current: string, next: string): Promise<void> {
  const cred = (await tx.select().from(credentials).where(eq(credentials.identityId, identityId)).limit(1))[0];
  if (!cred || !verifyPassword(current, cred.passwordHash)) throw new Error("Current password is incorrect");
  const problem = passwordProblem(next);
  if (problem) throw new Error(problem);
  await tx.update(credentials).set({ passwordHash: hashPassword(next), rotatedAt: new Date(), mustChange: false }).where(eq(credentials.identityId, identityId));
}

export async function setPassword(tx: Tx, identityId: string, next: string): Promise<void> {
  const problem = passwordProblem(next);
  if (problem) throw new Error(problem);
  await tx.update(credentials).set({ passwordHash: hashPassword(next), rotatedAt: new Date(), mustChange: false }).where(eq(credentials.identityId, identityId));
}

/** Issue a one-time reset. Retires any earlier live reset for the same person. */
export async function createPasswordReset(
  tx: Tx,
  input: { identityId: string; issuedBy?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  await tx
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.identityId, input.identityId), isNull(passwordResets.usedAt)));
  const { token, tokenHash } = mintToken(24);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000);
  await tx.insert(passwordResets).values({ id: newId(), identityId: input.identityId, tokenHash, issuedBy: input.issuedBy ?? null, expiresAt });
  return { token, expiresAt };
}

export async function findPasswordReset(tx: Tx, token: string): Promise<{ identity: Identity; profile: Profile; resetId: string } | null> {
  const rows = await tx
    .select({ reset: passwordResets, identity: identities, profile: profiles })
    .from(passwordResets)
    .innerJoin(identities, eq(identities.id, passwordResets.identityId))
    .innerJoin(profiles, eq(profiles.identityId, passwordResets.identityId))
    .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  return r ? { identity: r.identity, profile: r.profile, resetId: r.reset.id } : null;
}

/** Set the new password, burn the token, revoke every existing session. */
export async function consumePasswordReset(tx: Tx, token: string, newPassword: string): Promise<string> {
  const found = await findPasswordReset(tx, token);
  if (!found) throw new Error("This reset link is not valid or has expired");
  await setPassword(tx, found.identity.id, newPassword);
  await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, found.resetId));
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.identityId, found.identity.id), isNull(sessions.revokedAt)));
  return found.identity.id;
}

/** GDPR-style erasure: the identity row survives as a tombstone, nothing personal does. */
export async function eraseIdentity(tx: Tx, identityId: string): Promise<void> {
  await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.identityId, identityId));
  await tx.delete(credentials).where(eq(credentials.identityId, identityId));
  await tx.update(profiles).set({ name: "Deleted account", headline: null, bio: null, avatarUrl: null, phoneEnc: null, isPublic: false, handle: `deleted-${identityId.toLowerCase()}` }).where(eq(profiles.identityId, identityId));
  await tx
    .update(identities)
    .set({ email: `deleted+${identityId.toLowerCase()}@erased.homefax.invalid`, status: "deleted", deletedAt: new Date() })
    .where(eq(identities.id, identityId));
}
