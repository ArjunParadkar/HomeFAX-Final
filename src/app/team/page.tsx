import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ErrorLine from "@/components/ErrorLine";
import {
  addMemberAction,
  claimLegacyKeyAction,
  createCompanyAction,
  regenerateHfxKeyAction,
  removeMemberAction,
  updateCompanyAction,
} from "@/app/account/actions";
import { activeOrg, currentUser, getMembership, listMembers } from "@/lib/accounts";

/**
 * The company: who is in it, what it says about itself, and the one string
 * that gets it onto someone else's job. The key sits on the onyx plate because
 * it is an instrument, not a record — everything else here is paper.
 */

export const dynamic = "force-dynamic";

const ROLE_WORD: Record<"owner" | "admin" | "member", string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const sp = await searchParams;
  const org = await activeOrg(user.id);

  if (!org) {
    return (
      <>
        <AppHeader nav="team" eyebrow="Company" title="Team" subtitle="No company yet" />
        <main className="shell flex-1 space-y-6 py-5">
          <ErrorLine message={sp.error} />
          <section className="card overflow-hidden">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h2 className="eyebrow">Register your company</h2>
            </div>
            <p className="px-4 pt-3.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              A company holds the records, carries the HomeFAX key, and is what other builders add
              to their projects. Yours can be one person.
            </p>
            <form action={createCompanyAction} className="space-y-4 px-4 pb-4 pt-3.5">
              <div>
                <label className="label block" htmlFor="company-name">
                  Company name
                </label>
                <input
                  id="company-name"
                  name="name"
                  required
                  placeholder="Reyes Framing"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="company-headline">
                  What you do <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="company-headline"
                  name="headline"
                  placeholder="Framing and structural repair, Bentonville"
                  className="input mt-1.5"
                />
              </div>
              <button type="submit" className="btn btn-primary w-full">
                Register company
              </button>
            </form>
          </section>
        </main>
      </>
    );
  }

  const membership = await getMembership(org.id, user.id);
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const members = await listMembers(org.id);

  return (
    <>
      <AppHeader
        nav="team"
        eyebrow="Company"
        title={org.name}
        subtitle={org.headline ?? undefined}
        meta={`${members.length} member${members.length === 1 ? "" : "s"}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">The company</h2>
          </div>

          {canManage ? (
            <form action={updateCompanyAction} className="space-y-4 px-4 py-4">
              <input type="hidden" name="orgId" value={org.id} />
              <div>
                <label className="label block" htmlFor="name">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  required
                  defaultValue={org.name}
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="headline">
                  What you do
                </label>
                <input
                  id="headline"
                  name="headline"
                  defaultValue={org.headline ?? ""}
                  placeholder="Framing and structural repair, Bentonville"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="bio">
                  About
                </label>
                <textarea
                  id="bio"
                  name="bio"
                  rows={3}
                  defaultValue={org.bio ?? ""}
                  placeholder="Crew size, trades covered, where you work"
                  className="input mt-1.5"
                />
              </div>
              <label className="flex min-h-[2.75rem] items-center gap-3">
                <input
                  type="checkbox"
                  name="isPublic"
                  defaultChecked={org.isPublic}
                  className="h-5 w-5 shrink-0"
                  style={{ accentColor: "var(--accent)" }}
                />
                <span className="text-[0.875rem] leading-snug">Listed on the hire board</span>
              </label>
              <button type="submit" className="btn btn-primary w-full">
                Save company
              </button>
            </form>
          ) : (
            <dl className="rule-grid grid-cols-2">
              <div className="field">
                <dt>Name</dt>
                <dd>{org.name}</dd>
              </div>
              <div className="field">
                <dt>Listed</dt>
                <dd>{org.isPublic ? "Yes" : "No"}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="plate overflow-hidden">
          <div className="border-b border-[var(--line)] px-5 py-3">
            <h2 className="eyebrow">The HomeFAX key</h2>
          </div>
          <div className="px-5 py-4">
            <label className="label block" htmlFor="hfx-key">
              {org.name}
            </label>
            <input
              id="hfx-key"
              readOnly
              value={org.hfxKey}
              className="input tnum mt-1.5"
              style={{ color: "var(--claude)" }}
            />
            <p className="label mt-2">Press and hold to copy</p>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Give this to a builder to be added to their project. It is all they need — they paste
              it on the record and your crew can open it.
            </p>
          </div>

          {canManage && (
            <form action={regenerateHfxKeyAction} className="border-t border-[var(--line)] px-5 py-4">
              <input type="hidden" name="orgId" value={org.id} />
              <button type="submit" className="btn btn-secondary w-full">
                Issue a new key
              </button>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                The old key stops working immediately. Projects you are already on stay yours.
              </p>
            </form>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Members</h2>
          </div>

          {members.length === 0 ? (
            <p className="label px-4 pt-3.5">No members on file</p>
          ) : (
            <ul>
              {members.map(({ membership: m, user: u }) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">
                      {u.name}
                    </span>
                    <span className="tnum mt-0.5 block truncate text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      @{u.handle}
                      {m.title ? ` · ${m.title}` : ""}
                    </span>
                  </span>
                  <span className={`chip shrink-0 ${m.role === "owner" ? "chip-accent" : ""}`}>
                    {ROLE_WORD[m.role]}
                  </span>
                  {canManage && m.role !== "owner" && (
                    <form action={removeMemberAction} className="shrink-0">
                      <input type="hidden" name="membershipId" value={m.id} />
                      <button
                        type="submit"
                        className="chip min-h-[2.75rem] px-3"
                        style={{ borderColor: "var(--burnt)", color: "var(--burnt)" }}
                      >
                        Remove
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <form action={addMemberAction} className="space-y-3.5 px-4 py-4">
              <input type="hidden" name="orgId" value={org.id} />
              <div>
                <label className="label block" htmlFor="who">
                  Email or handle
                </label>
                <input
                  id="who"
                  name="who"
                  required
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="dana@crew.build or @dreyes"
                  className="input mt-1.5"
                />
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                  They need a HomeFAX account already. Ask them to sign up first.
                </p>
              </div>
              <div>
                <label className="label block" htmlFor="title">
                  Title <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="title"
                  name="title"
                  placeholder="Framing lead"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="role">
                  Role
                </label>
                <select id="role" name="role" defaultValue="member" className="input mt-1.5">
                  <option value="member">Member — films stages, sees the records</option>
                  <option value="admin">Admin — can also add people and edit the company</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary w-full">
                Add member
              </button>
            </form>
          ) : (
            <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Only an owner or admin can change who is on this crew.
            </p>
          )}
        </section>

        {canManage && org.claimedKeyId === null && (
          <section className="card overflow-hidden">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h2 className="eyebrow">Claim earlier records</h2>
            </div>
            <p className="px-4 pt-3.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Had a HomeFAX access key before accounts? Enter it once and every record it created
              moves to {org.name}.
            </p>
            <form action={claimLegacyKeyAction} className="space-y-3.5 px-4 pb-4 pt-3.5">
              <input type="hidden" name="orgId" value={org.id} />
              <div>
                <label className="label block" htmlFor="secret">
                  Old access key
                </label>
                <input
                  id="secret"
                  name="secret"
                  required
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="input tnum mt-1.5"
                />
              </div>
              <button type="submit" className="btn btn-secondary w-full">
                Claim records
              </button>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
