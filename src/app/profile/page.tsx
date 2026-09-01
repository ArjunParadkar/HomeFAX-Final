import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ErrorLine from "@/components/ErrorLine";
import {
  createCompanyAction,
  signOutAction,
  updateProfileAction,
} from "@/app/account/actions";
import { currentUser, getMembership, listOrgsForUser } from "@/lib/accounts";

/**
 * The person behind the record. What is here is what the hire board shows —
 * nothing is published that the reader has not typed, and the listing switch
 * says exactly where the words end up.
 */

export const dynamic = "force-dynamic";

const ROLE_WORD: Record<"owner" | "admin" | "member", string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const sp = await searchParams;
  const orgs = await listOrgsForUser(user.id);
  const rows = await Promise.all(
    orgs.map(async (o) => ({ org: o, role: (await getMembership(o.id, user.id))?.role ?? "member" })),
  );

  return (
    <>
      <AppHeader
        nav="profile"
        eyebrow="Account"
        title={user.name}
        subtitle={`@${user.handle}`}
        meta={`${orgs.length} compan${orgs.length === 1 ? "y" : "ies"}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Your details</h2>
          </div>
          <form action={updateProfileAction} className="space-y-4 px-4 py-4">
            <div>
              <label className="label block" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                name="name"
                required
                autoComplete="name"
                defaultValue={user.name}
                className="input mt-1.5"
              />
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
                defaultValue={user.handle}
                className="input tnum mt-1.5"
              />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                How crews find you on the hire board.
              </p>
            </div>
            <div>
              <label className="label block" htmlFor="headline">
                Your trade
              </label>
              <input
                id="headline"
                name="headline"
                defaultValue={user.headline ?? ""}
                placeholder="Framing lead, 12 years"
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
                defaultValue={user.bio ?? ""}
                placeholder="What you take on, where you work, who you have built for"
                className="input mt-1.5"
              />
            </div>
            <label className="flex min-h-[2.75rem] items-center gap-3">
              <input
                type="checkbox"
                name="isPublic"
                defaultChecked={user.isPublic}
                className="h-5 w-5 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
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

          {rows.length === 0 ? (
            <p className="label px-4 pt-3.5">No companies on file</p>
          ) : (
            <ul>
              {rows.map(({ org, role }) => (
                <li
                  key={org.id}
                  className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">
                      {org.name}
                    </span>
                    {org.headline && (
                      <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ink-3)]">
                        {org.headline}
                      </span>
                    )}
                  </span>
                  <span className={`chip shrink-0 ${role === "owner" ? "chip-accent" : ""}`}>
                    {ROLE_WORD[role]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form action={createCompanyAction} className="space-y-3.5 px-4 py-4">
            <div>
              <label className="label block" htmlFor="company-name">
                Register another company
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
                What it does <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input
                id="company-headline"
                name="headline"
                placeholder="Framing and structural repair, Bentonville"
                className="input mt-1.5"
              />
            </div>
            <button type="submit" className="btn btn-secondary w-full">
              Register company
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
            <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Ends this session on this device. The records stay with the company.
            </p>
            <button
              type="submit"
              className="btn btn-secondary mt-3.5 w-full"
              style={{ borderColor: "var(--burnt)", color: "var(--burnt)" }}
            >
              Sign out
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
