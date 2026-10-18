/**
 * Sign-in throttling, as pure arithmetic over the recent failed attempts for
 * one email or one address. The database keeps the attempts; this decides.
 *
 * Five failures in fifteen minutes locks the account for fifteen minutes.
 * Twenty failures from one IP in fifteen minutes locks the IP.
 */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

export type Lockout = { locked: boolean; retryAfterMs: number; failures: number };

export function lockoutFor(
  failedAt: Date[],
  limit: number,
  now: Date = new Date(),
): Lockout {
  const recent = failedAt
    .map((d) => d.getTime())
    .filter((t) => now.getTime() - t < ATTEMPT_WINDOW_MS)
    .sort((a, b) => a - b);
  if (recent.length < limit) return { locked: false, retryAfterMs: 0, failures: recent.length };
  const newest = recent[recent.length - 1];
  const until = newest + LOCKOUT_MS;
  const retryAfterMs = Math.max(0, until - now.getTime());
  return { locked: retryAfterMs > 0, retryAfterMs, failures: recent.length };
}
