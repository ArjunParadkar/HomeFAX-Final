import { cookies } from "next/headers";
import { ErrorLine } from "@homefax/ui";
import { orgs } from "@homefax/db";
import {
  addJurisdictionAction,
  createInvitationAction,
  dismissInvitationLinkAction,
  removeJurisdictionAction,
  removeMemberAction,
  revokeInvitationAction,
  setMemberRoleAction,
  transferOwnershipAction,
  updateOrgAction,
} from "@/app/(workspace)/team/actions";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { date, dateTime } from "@/lib/format";
import { INVITE_COOKIE, asWorkspace, KIND_LABEL } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const ROLE_WORD = { owner: "Owner", admin: "Admin", member: "Member" } as const;

/** Members, invitations, the institution's own profile, and — for municipalities — the territory. */
export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const sp = await searchParams;
  const data = await asWorkspace(async (tx, ws) => {
    const members = await orgs.listMembers(tx, ws.org.id);
    const invitations = ws.isAdmin ? await orgs.listInvitations(tx, ws.org.id) : [];
    const jurisdictions = ws.org.kind === "municipality" ? await orgs.listJurisdictions(tx, ws.org.id) : [];
    return { ws, members, invitations, jurisdictions };
  });
  const { ws, members, invitations, jurisdictions } = data;
  const raw = (await cookies()).get(INVITE_COOKIE)?.value;
  let shown: { url: string; expiresAt: string; email: string | null } | null = null;
  try {
    shown = raw ? JSON.parse(raw) : null;
  } catch {
    shown = null;
  }

  return (
    <>
      <PageTitle eyebrow="Team" title={ws.org.name} subtitle={`${KIND_LABEL[ws.org.kind]} · ${members.length} ${members.length === 1 ? "person" : "people"} · you are ${ROLE_WORD[ws.org.role].toLowerCase()}`} />
      <ErrorLine message={sp.error} className="mb-4" />
      {sp.ok === "org" && <p className="mb-4 text-[0.8125rem] text-[var(--grade-a)]">Institution profile saved.</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Panel title="Members" meta={`${members.length}`} flush>
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Since</th>
                    {ws.isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const self = m.profile.identityId === ws.me.identity.id;
                    const canEdit = ws.isAdmin && m.membership.role !== "owner" && !self;
                    return (
                      <tr key={m.membership.id}>
                        <td>
                          <span className="block font-medium">
                            {m.profile.name}
                            {self ? " (you)" : ""}
                          </span>
                          <span className="text-[0.6875rem] text-[var(--ink-3)]">
                            @{m.profile.handle}
                            {m.membership.title ? ` · ${m.membership.title}` : m.profile.headline ? ` · ${m.profile.headline}` : ""}
                          </span>
                        </td>
                        <td>
                          <span className={`chip ${m.membership.role === "owner" ? "chip-accent" : ""}`}>{ROLE_WORD[m.membership.role]}</span>
                        </td>
                        <td className="mono">{date(m.membership.createdAt)}</td>
                        {ws.isAdmin && (
                          <td className="num">
                            {canEdit && (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <form action={setMemberRoleAction}>
                                  <input type="hidden" name="membershipId" value={m.membership.id} />
                                  <input type="hidden" name="role" value={m.membership.role === "admin" ? "member" : "admin"} />
                                  <button type="submit" className="btn btn-secondary btn-sm">
                                    {m.membership.role === "admin" ? "Make member" : "Make admin"}
                                  </button>
                                </form>
                                {ws.org.role === "owner" && (
                                  <form action={transferOwnershipAction}>
                                    <input type="hidden" name="identityId" value={m.profile.identityId} />
                                    <button type="submit" className="btn btn-secondary btn-sm">
                                      Make owner
                                    </button>
                                  </form>
                                )}
                                <form action={removeMemberAction}>
                                  <input type="hidden" name="membershipId" value={m.membership.id} />
                                  <button type="submit" className="btn btn-secondary btn-sm">
                                    Remove
                                  </button>
                                </form>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {ws.isAdmin && (
            <Panel title="Invite by link" meta={invitations.length ? `${invitations.length} open` : undefined}>
              {shown && (
                <div className="sheet mb-4 px-4 py-3">
                  <p className="label">Invitation link · shown once</p>
                  <p className="tnum mt-1.5 break-all text-[0.8125rem]">{shown.url}</p>
                  <p className="mt-1.5 text-[0.75rem] text-[var(--ink-3)]">
                    {shown.email ? `For ${shown.email}. ` : ""}Valid until {dateTime(shown.expiresAt)}. Copy it now; it is not stored in clear.
                  </p>
                  <form action={dismissInvitationLinkAction} className="mt-2">
                    <button type="submit" className="btn btn-secondary btn-sm">
                      Done
                    </button>
                  </form>
                </div>
              )}
              <form action={createInvitationAction} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label className="label block" htmlFor="inv-email">
                    Email <span className="normal-case tracking-normal">(optional)</span>
                  </label>
                  <input id="inv-email" name="email" type="email" placeholder="colleague@city.gov" className="input input-sm mt-1.5" />
                </div>
                <div>
                  <label className="label block" htmlFor="inv-title">
                    Title
                  </label>
                  <input id="inv-title" name="title" placeholder="Inspector" className="input input-sm mt-1.5" />
                </div>
                <div>
                  <label className="label block" htmlFor="inv-role">
                    Role
                  </label>
                  <select id="inv-role" name="role" defaultValue="member" className="input input-sm select mt-1.5">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary btn-sm">
                  Create link
                </button>
              </form>
              {invitations.length > 0 && (
                <ul className="mt-4 border-t border-[var(--line)]">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 last:border-b-0">
                      <span className="min-w-0 flex-1 text-[0.8125rem]">
                        <span className="font-medium">{i.email ?? "Anyone with the link"}</span>
                        <span className="text-[var(--ink-3)]">
                          {" "}
                          · {ROLE_WORD[i.role]}
                          {i.title ? ` · ${i.title}` : ""} · expires {date(i.expiresAt)}
                        </span>
                      </span>
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="invitationId" value={i.id} />
                        <button type="submit" className="btn btn-secondary btn-sm">
                          Revoke
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {ws.org.kind === "municipality" && (
            <Panel title="Jurisdictions" meta="Your statutory view, at ledger scope" flush>
              {jurisdictions.length === 0 ? (
                <Empty>No jurisdiction yet, so no house is in view. Add the territory below.</Empty>
              ) : (
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>City</th>
                      <th>County</th>
                      <th>ZIP</th>
                      {ws.isAdmin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {jurisdictions.map((j) => (
                      <tr key={j.id}>
                        <td className="mono">{j.state}</td>
                        <td>{j.city ?? "—"}</td>
                        <td>{j.county ?? "—"}</td>
                        <td className="mono">{j.postalCode ?? "—"}</td>
                        {ws.isAdmin && (
                          <td className="num">
                            <form action={removeJurisdictionAction}>
                              <input type="hidden" name="jurisdictionId" value={j.id} />
                              <button type="submit" className="btn btn-secondary btn-sm">
                                Remove
                              </button>
                            </form>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {ws.isAdmin && (
                <form action={addJurisdictionAction} className="grid gap-3 border-t border-[var(--line)] px-4 py-4 sm:grid-cols-[4rem_1fr_1fr_6rem_auto] sm:items-end">
                  <div>
                    <label className="label block" htmlFor="j-state">
                      State
                    </label>
                    <input id="j-state" name="state" required maxLength={2} placeholder="AR" className="input input-sm tnum mt-1.5 uppercase" />
                  </div>
                  <div>
                    <label className="label block" htmlFor="j-city">
                      City
                    </label>
                    <input id="j-city" name="city" placeholder="Rogers" className="input input-sm mt-1.5" />
                  </div>
                  <div>
                    <label className="label block" htmlFor="j-county">
                      County
                    </label>
                    <input id="j-county" name="county" placeholder="Benton" className="input input-sm mt-1.5" />
                  </div>
                  <div>
                    <label className="label block" htmlFor="j-zip">
                      ZIP
                    </label>
                    <input id="j-zip" name="postalCode" placeholder="72758" inputMode="numeric" className="input input-sm tnum mt-1.5" />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm">
                    Add
                  </button>
                </form>
              )}
            </Panel>
          )}
        </div>

        <Panel title="Institution profile">
          {ws.isAdmin ? (
            <form action={updateOrgAction} className="space-y-4">
              <div>
                <label className="label block" htmlFor="org-name">
                  Name
                </label>
                <input id="org-name" name="name" required minLength={2} defaultValue={ws.org.name} className="input input-sm mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="org-headline">
                  Headline
                </label>
                <input id="org-headline" name="headline" defaultValue={ws.org.headline ?? ""} className="input input-sm mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="org-bio">
                  About
                </label>
                <textarea id="org-bio" name="bio" rows={4} defaultValue={ws.org.bio ?? ""} className="input input-sm mt-1.5" />
              </div>
              <label className="flex items-center gap-2.5 text-[0.8125rem]">
                <input type="checkbox" name="isPublic" defaultChecked={ws.org.isPublic} className="accent-[var(--accent)]" />
                Listed publicly, so owners can find and grant you access by name
              </label>
              <dl className="rule-grid grid-cols-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)]">
                <div className="field">
                  <dt>Kind</dt>
                  <dd>{KIND_LABEL[ws.org.kind]}</dd>
                </div>
                <div className="field">
                  <dt>Registered</dt>
                  <dd>{date(ws.org.createdAt)}</dd>
                </div>
              </dl>
              <button type="submit" className="btn btn-primary btn-sm">
                Save
              </button>
            </form>
          ) : (
            <dl className="rule-grid grid-cols-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)]">
              <div className="field">
                <dt>Kind</dt>
                <dd>{KIND_LABEL[ws.org.kind]}</dd>
              </div>
              <div className="field">
                <dt>Registered</dt>
                <dd>{date(ws.org.createdAt)}</dd>
              </div>
              <div className="field col-span-2">
                <dt>Headline</dt>
                <dd>{ws.org.headline ?? "—"}</dd>
              </div>
            </dl>
          )}
        </Panel>
      </div>
    </>
  );
}
