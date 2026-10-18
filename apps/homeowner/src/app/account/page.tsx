import { auth, people } from "@homefax/db";
import { ErrorLine } from "@homefax/ui";
import {
  changePasswordAction,
  deleteAccountAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  signOutAction,
  updateProfileAction,
} from "./actions";
import AppHeader from "@/components/AppHeader";
import { formatWhen } from "@/lib/format";
import { kit } from "@/lib/kit";

/**
 * You. Name, handle, a phone number kept encrypted and shown masked, the
 * password, every device signed in, the way out, and the way out for good.
 */

export const dynamic = "force-dynamic";

const OK_WORD: Record<string, string> = {
  profile: "Saved.",
  password: "Password changed. Other devices stay signed in until you revoke them below.",
  sessions: "Every other device has been signed out.",
};

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const sp = await searchParams;
  const ok = Array.isArray(sp.ok) ? sp.ok[0] : sp.ok;

  const data = await kit.asMe(async (tx, me) => {
    const profile = (await people.getProfile(tx, me.identity.id)) ?? me.profile;
    const sessions = await auth.listSessions(tx, me.identity.id);
    return { me, profile, phone: people.phoneOf(profile), sessions };
  });
  const { me, profile, phone, sessions } = data;

  return (
    <>
      <AppHeader nav="account" eyebrow="Account" title={profile.name} subtitle={me.identity.email} meta={`@${profile.handle}`} />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />
        {ok && OK_WORD[ok] && (
          <p role="status" className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {OK_WORD[ok]}
          </p>
        )}

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">You</h2>
          </div>
          <form action={updateProfileAction} className="space-y-4 px-4 py-4">
            <div>
              <label className="label block" htmlFor="name">
                Name
              </label>
              <input id="name" name="name" defaultValue={profile.name} required autoComplete="name" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="handle">
                Handle
              </label>
              <input id="handle" name="handle" defaultValue={profile.handle} required autoCapitalize="off" autoCorrect="off" spellCheck={false} className="input tnum mt-1.5" />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">3–24 lowercase letters, numbers, or hyphens.</p>
            </div>
            <div>
              <label className="label block" htmlFor="phone">
                Phone <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={phone ?? ""} placeholder={phone ? maskPhone(phone) : "+1 479 555 0100"} className="input tnum mt-1.5" />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                {phone ? `On file as ${maskPhone(phone)}, stored encrypted. ` : "Stored encrypted. "}
                Only you and the people you grant access can reach you through it. Leave blank to remove it.
              </p>
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Save
            </button>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Password</h2>
          </div>
          <form action={changePasswordAction} className="space-y-4 px-4 py-4">
            <div>
              <label className="label block" htmlFor="currentPassword">
                Current password
              </label>
              <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="password">
                New password
              </label>
              <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input mt-1.5" />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Ten characters or more.</p>
            </div>
            <div>
              <label className="label block" htmlFor="confirm">
                New password again
              </label>
              <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input mt-1.5" />
            </div>
            <button type="submit" className="btn btn-secondary w-full">
              Change password
            </button>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Signed in</h2>
            <span className="tnum text-[0.625rem] text-[var(--ink-3)]">
              {sessions.length} device{sessions.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul>
            {sessions.map((s) => {
              const current = s.id === me.session.id;
              return (
                <li key={s.id} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.875rem] font-medium leading-snug">{describeDevice(s.userAgent)}</span>
                    <span className="tnum mt-0.5 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      {current ? "this device" : `last seen ${formatWhen(s.lastSeenAt)}`}
                      {s.ip ? ` · ${s.ip}` : ""}
                    </span>
                  </span>
                  {current ? (
                    <span className="chip chip-accent shrink-0">Now</span>
                  ) : (
                    <form action={revokeSessionAction} className="shrink-0">
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button type="submit" className="chip min-h-[2.75rem] px-3">
                        Revoke
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {sessions.length > 1 && (
            <form action={revokeOtherSessionsAction} className="border-t border-[var(--line)] px-4 py-3">
              <button type="submit" className="btn btn-secondary w-full">
                Sign out every other device
              </button>
            </form>
          )}
        </section>

        <form action={signOutAction}>
          <button type="submit" className="btn btn-secondary w-full">
            Sign out
          </button>
        </form>

        <details className="card overflow-hidden">
          <summary className="flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="eyebrow block" style={{ color: "var(--grade-f)" }}>
                Delete my account
              </span>
              <span className="mt-1 block text-[0.8125rem] leading-snug text-[var(--ink-2)]">Erases you, keeps the houses&apos; history</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
              <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <form action={deleteAccountAction} className="space-y-4 border-t border-[var(--line)] px-4 py-4">
            <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Your password, name, handle and phone are erased and this email can no longer sign in. The houses you own keep their records and their ownership history; your name on them becomes “Deleted account”. This cannot be undone.
            </p>
            <div>
              <label className="label block" htmlFor="delete-password">
                Your password, to confirm
              </label>
              <input id="delete-password" name="password" type="password" required autoComplete="current-password" className="input mt-1.5" />
            </div>
            <button type="submit" className="btn w-full" style={{ background: "var(--grade-f)", color: "var(--accent-ink)" }}>
              Erase my account
            </button>
          </form>
        </details>
      </main>
    </>
  );
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `••• ••• ${digits.slice(-4)}`;
}

function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /HeadlessChrome/.test(ua) ? "automated browser" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "browser";
  return `${os} · ${browser}`;
}
