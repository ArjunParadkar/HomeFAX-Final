import AppHeader from "@/components/AppHeader";
import { ErrorLine } from "@homefax/ui";
import { PASSWORD_MIN } from "@homefax/auth";
import { auth, orgs, type MemberRole, type Session } from "@homefax/db";
import {
  changePasswordAction,
  createCompanyAction,
  revokeOtherSessionsAction,
  signOutAction,
  updateProfileAction,
} from "@/app/account/actions";
import { kit } from "@/lib/kit";

/**
 * The person behind the record. What is here is what the hire board shows —
 * nothing is published that the reader has not typed, and the listing switch
 * says exactly where the words end up. Below that: every device signed in as
 * them, and the two ways out.
 */

export const dynamic = "force-dynamic";

const ROLE_WORD: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const APP_WORD: Record<Session["app"], string> = {
  contractor: "Contractor",
  homeowner: "Homeowner",
  admin: "Institutions",
};

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const sp = await searchParams;

  const { me, mine, sessions } = await kit.asMe(async (tx, me) => ({
    me,
    mine: await orgs.listOrgsForIdentity(tx, me.identity.id),
    // Sessions are the person's own rows: row-level security lets them read and revoke theirs.
    sessions: await auth.listSessions(tx, me.identity.id),
  }));
  const profile = me.profile;
  const others = sessions.filter((s) => s.id !== me.session.id);

  return (
    <>
      <AppHeader
        nav="profile"
        eyebrow="Account"
        title={profile.name}
        subtitle={`@${profile.handle}`}
        meta={`${mine.length} compan${mine.length === 1 ? "y" : "ies"}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />
        {sp.ok === "password" && (
          <p role="status" className="text-[0.8125rem] leading-relaxed" style={{ color: "var(--claude)" }}>
            Password changed. Other devices stay signed in until you sign them out below.
          </p>
        )}
        {sp.ok === "sessions" && (
          <p role="status" className="text-[0.8125rem] leading-relaxed" style={{ color: "var(--claude)" }}>
            Signed out everywhere else{sp.n ? ` — ${sp.n} session${sp.n === "1" ? "" : "s"} ended` : ""}. This device stays signed in.
          </p>
        )}

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Your details</h2>
          </div>
          <form action={updateProfileAction} className="space-y-4 px-4 py-4">
            <div>
              <label className="label block" htmlFor="name">
                Name
              </label>
              <input id="name" name="name" required autoComplete="name" defaultValue={profile.name} className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="handle">
                Handle
              </label>
              <input
                id="handle"
                name="handle"
                required
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                defaultValue={profile.handle}
                className="input tnum mt-1.5"
              />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">How crews find you on the hire board.</p>
            </div>
            <div>
              <label className="label block" htmlFor="headline">
                Your trade
              </label>
              <input id="headline" name="headline" defaultValue={profile.headline ?? ""} placeholder="Framing lead, 12 years" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="bio">
                About
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={3}
                defaultValue={profile.bio ?? ""}
                placeholder="What you take on, where you work, who you have built for"
                className="input mt-1.5"
              />
            </div>
            <label className="flex min-h-[2.75rem] items-center gap-3">
              <input type="checkbox" name="isPublic" defaultChecked={profile.isPublic} className="h-5 w-5 shrink-0" style={{ accentColor: "var(--accent)" }} />
              <span className="text-[0.875rem] leading-snug">Listed on the hire board</span>
            </label>
            <button type="submit" className="btn btn-primary w-full">
              Save details
            </button>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">My companies</h2>
          </div>

          {mine.length === 0 ? (
            <p className="label px-4 pt-3.5">No companies on file</p>
          ) : (
            <ul>
              {mine.map((org) => (
                <li key={org.id} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">{org.name}</span>
                    {org.headline && <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ink-3)]">{org.headline}</span>}
                  </span>
                  <span className={`chip shrink-0 ${org.role === "owner" ? "chip-accent" : ""}`}>{ROLE_WORD[org.role]}</span>
                </li>
              ))}
            </ul>
          )}

          <form action={createCompanyAction} className="space-y-3.5 px-4 py-4">
            <div>
              <label className="label block" htmlFor="company-name">
                Register another company
              </label>
              <input id="company-name" name="name" required placeholder="Reyes Framing" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="company-headline">
                What it does <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input id="company-headline" name="headline" placeholder="Framing and structural repair, Bentonville" className="input mt-1.5" />
            </div>
            <button type="submit" className="btn btn-secondary w-full">
              Register company
            </button>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Password</h2>
          </div>
          <form action={changePasswordAction} className="space-y-3.5 px-4 py-4">
            <div>
              <label className="label block" htmlFor="current-password">
                Current password
              </label>
              <input id="current-password" name="currentPassword" type="password" required autoComplete="current-password" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="new-password">
                New password
              </label>
              <input id="new-password" name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" className="input mt-1.5" />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Ten characters or more. Nothing off a breach list.</p>
            </div>
            <div>
              <label className="label block" htmlFor="confirm-password">
                New password again
              </label>
              <input id="confirm-password" name="confirm" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" className="input mt-1.5" />
            </div>
            <button type="submit" className="btn btn-secondary w-full">
              Change password
            </button>
            <p className="text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
              Forgot it? Your company&apos;s owner or admin can hand you a one-time reset link from their Team page.
            </p>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">
              Signed in on {sessions.length} device{sessions.length === 1 ? "" : "s"}
            </h2>
          </div>
          <ul>
            {sessions.map((s) => {
              const current = s.id === me.session.id;
              return (
                <li key={s.id} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">
                      {deviceOf(s.userAgent)} · {APP_WORD[s.app]}
                    </span>
                    <span className="tnum mt-0.5 block truncate text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      Last seen {relative(s.lastSeenAt)}
                      {s.ip ? ` · ${s.ip}` : ""}
                    </span>
                  </span>
                  {current && <span className="chip chip-accent shrink-0">This device</span>}
                </li>
              );
            })}
          </ul>
          <form action={revokeOtherSessionsAction} className="px-4 py-4">
            <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              {others.length === 0
                ? "No other device is signed in as you."
                : `Ends ${others.length} other session${others.length === 1 ? "" : "s"} — a lost phone, a shared laptop — and keeps this one.`}
            </p>
            <button type="submit" className="btn btn-secondary mt-3.5 w-full" disabled={others.length === 0}>
              Sign out everywhere else
            </button>
          </form>
        </section>

        <section className="card overflow-hidden" style={{ borderColor: "var(--burnt)" }}>
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow" style={{ color: "var(--burnt)" }}>
              Sign out
            </h2>
          </div>
          <form action={signOutAction} className="px-4 py-4">
            <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">Ends this session on this device. The records stay with the company.</p>
            <button type="submit" className="btn btn-secondary mt-3.5 w-full" style={{ borderColor: "var(--burnt)", color: "var(--burnt)" }}>
              Sign out
            </button>
          </form>
        </section>
      </main>
    </>
  );
}

/** A short reading of a user agent: the device family, not the version string. */
function deviceOf(ua: string | null): string {
  if (!ua) return "A device";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Linux/i.test(ua)) return "Linux";
  if (/HeadlessChrome|Playwright|node/i.test(ua)) return "Automated browser";
  return "A browser";
}

function relative(d: Date): string {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
