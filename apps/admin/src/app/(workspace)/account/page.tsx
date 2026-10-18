import { ErrorLine } from "@homefax/ui";
import { auth, people } from "@homefax/db";
import { changePasswordAction, revokeOtherSessionsAction, revokeSessionAction, signOutAction, updateProfileAction } from "@/app/account/actions";
import PageTitle from "@/components/PageTitle";
import Panel from "@/components/Panel";
import { dateTime } from "@/lib/format";
import { asWorkspace, KIND_LABEL } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** The person: profile, password, the devices signed in, and the way out. */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const sp = await searchParams;
  const data = await asWorkspace(async (tx, ws) => {
    const profile = await people.getProfile(tx, ws.me.identity.id);
    const sessions = await auth.listSessions(tx, ws.me.identity.id);
    return { ws, profile: profile!, sessions };
  });
  const { ws, profile, sessions } = data;
  const ok = Array.isArray(sp.ok) ? sp.ok[0] : sp.ok;

  return (
    <>
      <PageTitle eyebrow="Account" title={profile.name} subtitle={`${ws.me.identity.email} · member of ${ws.all.map((o) => `${o.name} (${KIND_LABEL[o.kind]})`).join(", ")}`} />
      <ErrorLine message={sp.error} className="mb-4" />
      {ok === "profile" && <p className="mb-4 text-[0.8125rem] text-[var(--grade-a)]">Profile saved.</p>}
      {ok === "password" && <p className="mb-4 text-[0.8125rem] text-[var(--grade-a)]">Password changed.</p>}
      {ok === "sessions" && <p className="mb-4 text-[0.8125rem] text-[var(--grade-a)]">Every other device is signed out.</p>}

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Profile">
          <form action={updateProfileAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label block" htmlFor="name">
                  Name
                </label>
                <input id="name" name="name" required defaultValue={profile.name} className="input input-sm mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="handle">
                  Handle
                </label>
                <input id="handle" name="handle" required defaultValue={profile.handle} className="input input-sm tnum mt-1.5" />
              </div>
            </div>
            <div>
              <label className="label block" htmlFor="headline">
                Role
              </label>
              <input id="headline" name="headline" defaultValue={profile.headline ?? ""} placeholder="Building inspector" className="input input-sm mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="phone">
                Phone <span className="normal-case tracking-normal">(stored encrypted)</span>
              </label>
              <input id="phone" name="phone" type="tel" defaultValue={people.phoneOf(profile) ?? ""} className="input input-sm tnum mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="bio">
                About
              </label>
              <textarea id="bio" name="bio" rows={3} defaultValue={profile.bio ?? ""} className="input input-sm mt-1.5" />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              Save profile
            </button>
          </form>
        </Panel>

        <div className="space-y-5">
          <Panel title="Password">
            <form action={changePasswordAction} className="space-y-4">
              <div>
                <label className="label block" htmlFor="currentPassword">
                  Current password
                </label>
                <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className="input input-sm mt-1.5" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label block" htmlFor="password">
                    New password
                  </label>
                  <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input input-sm mt-1.5" />
                </div>
                <div>
                  <label className="label block" htmlFor="confirm">
                    Again
                  </label>
                  <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input input-sm mt-1.5" />
                </div>
              </div>
              <button type="submit" className="btn btn-secondary btn-sm">
                Change password
              </button>
            </form>
          </Panel>

          <Panel title="Sessions" meta={`${sessions.length} signed in`} flush>
            <ul>
              {sessions.map((s) => {
                const current = s.id === ws.me.session.id;
                return (
                  <li key={s.id} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8125rem] font-medium">
                        {s.app} · {current ? "this device" : s.ip ?? "unknown address"}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-[var(--ink-3)]">
                        last seen {dateTime(s.lastSeenAt)} · {s.userAgent?.slice(0, 60) ?? "unknown browser"}
                      </span>
                    </span>
                    {!current && (
                      <form action={revokeSessionAction}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button type="submit" className="btn btn-secondary btn-sm">
                          Sign out
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              <form action={revokeOtherSessionsAction}>
                <button type="submit" className="btn btn-secondary btn-sm">
                  Sign out other devices
                </button>
              </form>
              <form action={signOutAction}>
                <button type="submit" className="btn btn-primary btn-sm">
                  Sign out here
                </button>
              </form>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
