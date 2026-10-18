import Link from "next/link";
import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { ErrorLine, GradeChip, PartsTable } from "@homefax/ui";
import { viewProperty } from "@homefax/app-kit";
import { STAGES, cumulativeParts, stageDef } from "@homefax/core";
import { access, orgs, properties, records, type Scope } from "@homefax/db";
import { addCompanyByKeyAction, assignAction, dismissClaimCodeAction, setAssignmentStatusAction } from "@/app/account/actions";
import { issueClaimCodeAction } from "@/app/records/actions";
import { cityLineOf, formatDate, streetOf } from "@/lib/address";
import { kit } from "@/lib/kit";
import { homeownerAppUrl, orgContext } from "@/lib/session";
import { CLAIM_CODE_COOKIE, readShowOnce, type IssuedClaimCode } from "@/lib/show-once";

export const dynamic = "force-dynamic";

const ROLE_WORD: Record<"owner" | "collaborator", string> = {
  owner: "Owner",
  collaborator: "Collaborator",
};

const OWNER_ROLE_WORD: Record<"owner" | "co_owner" | "tenant", string> = {
  owner: "Owner",
  co_owner: "Co-owner",
  tenant: "Tenant",
};

export default async function RecordPage({ params, searchParams }: PageProps<"/records/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;

  const data = await kit.asMe(async (tx, me) => {
    const found = await records.getRecordBySlug(tx, slug);
    if (!found) return null;
    const { record, property, stats } = found;
    const { org } = await orgContext(tx, me);
    // Every look that is not the owner's is logged; a reader with no scope gets a 404, not a hint.
    const view = await viewProperty(tx, property.id, { identityId: me.identity.id }, { app: "contractor", path: `/records/${slug}`, orgId: org?.id });
    if (!view) return null;

    const captures = await records.listCaptures(tx, record.id);
    const team = await records.listProjectOrgs(tx, record.id);
    const members = org ? await orgs.listMembers(tx, org.id) : [];
    const assignments = await records.listAssignmentsForRecord(tx, record.id);
    const names = await records.namesFor(tx, assignments.map((a) => a.assigneeIdentityId).filter((x): x is string => x != null));

    // Hand-off: who owns the house, and who outside the project may see it.
    const owners = await properties.listOwners(tx, property.id);
    const invites = await properties.listOwnerInvites(tx, property.id);
    const grants = await access.listGrants(tx, property.id);
    const requests = await access.listRequestsForProperty(tx, property.id, "pending");
    const outsideOrgs = await orgs.getOrgsByIds(tx, [
      ...grants.map((g) => g.granteeOrgId).filter((x): x is string => x != null),
      ...requests.map((r) => r.requesterOrgId),
    ]);
    const granteePeople = await records.namesFor(tx, grants.map((g) => g.granteeIdentityId).filter((x): x is string => x != null));
    const municipalities = await orgs.municipalitiesCovering(tx, property);

    return { me, org, record, property, stats, captures, team, members, assignments, names, owners, invites, grants, requests, outsideOrgs, granteePeople, municipalities };
  });
  if (!data) notFound();

  const { me, org, record, property, stats, captures, team, members, assignments, names, owners, invites, grants, requests, outsideOrgs, granteePeople, municipalities } = data;
  const issued = await readShowOnce<IssuedClaimCode>(CLAIM_CODE_COOKIE);
  const claimCode = issued?.slug === slug ? issued : null;

  const byStage = new Map(captures.map((c) => [c.stage, c]));
  const recorded = captures.filter((c) => c.state === "done").length;

  const rollup = cumulativeParts(
    captures.filter((c) => c.state === "done" && c.parts.length > 0).map((c) => ({ stage: c.stage, parts: c.parts })),
  );

  // The parties on this record, and who work can be handed to: the reader's
  // own crew by name, or any company already on the project.
  const memberNames = new Map(members.map((m) => [m.profile.identityId, m.profile.name]));
  const teamNames = new Map(team.map((t) => [t.org.id, t.org.name]));
  const readerId = me.identity.id;
  function assigneeName(identityId: string | null, orgId: string | null): string {
    if (identityId) return identityId === readerId ? "You" : (memberNames.get(identityId) ?? names.get(identityId) ?? "A person");
    if (orgId) return teamNames.get(orgId) ?? "A company";
    return "Unassigned";
  }
  const canAssign = members.length > 0 || team.length > 0;
  const street = streetOf(property);

  return (
    <>
      <AppHeader
        back={{ href: "/records", label: "On file" }}
        eyebrow="Build record"
        title={street}
        subtitle={record.ownerName ? `Held for ${record.ownerName} · ${cityLineOf(property)}` : cityLineOf(property)}
        meta={`${String(recorded).padStart(2, "0")}/${STAGES.length}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        <section className="card overflow-hidden">
          <dl className="rule-grid grid-cols-2 border-t-0">
            <div className="field">
              <dt>Opened</dt>
              <dd>{formatDate(record.openedAt)}</dd>
            </div>
            <div className="field">
              <dt>Stages on file</dt>
              <dd>
                {stats.stagesFilmed} / {STAGES.length}
              </dd>
            </div>
            <div className="field">
              <dt>Points passed</dt>
              <dd>{stats.pointsAssessed > 0 ? `${stats.pointsPassed} / ${stats.pointsAssessed}` : "—"}</dd>
            </div>
            <div className="field">
              <dt>Filed by</dt>
              <dd className="truncate">{record.contractorName ?? org?.name ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="eyebrow">The sequence</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Stages close in order and never reopen. Tap one to film it, or to read what is already on the record.
          </p>

          <ol className="mt-3">
            {STAGES.map((stage, i) => {
              const capture = byStage.get(stage.id);
              const state = capture?.state;
              const done = state === "done";
              const working = state != null && records.IN_FLIGHT_STATES.has(state);
              const grade = capture?.quality?.grade;
              return (
                <li key={stage.id} className="rail relative pb-1.5">
                  <Link href={`/records/${record.slug}/stages/${stage.id}`} className="flex min-h-[3.25rem] items-center gap-3.5 py-2">
                    <span
                      className="tnum relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold"
                      style={{
                        borderColor: done ? "transparent" : "var(--line)",
                        background: done ? "var(--accent)" : "var(--surface)",
                        color: done ? "var(--accent-ink)" : "var(--ink-3)",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-medium leading-snug">{stage.label}</span>
                      <span className="tnum block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                        {done ? "Model on file" : state === "failed" ? "Failed — refilm" : working ? "Building model" : "Not filmed"}
                      </span>
                    </span>
                    {grade ? (
                      <GradeChip grade={grade} size="sm" />
                    ) : done ? (
                      <ModelMark />
                    ) : working ? (
                      <span className="pulsing h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        {claimCode && (
          <section className="plate overflow-hidden">
            <div className="border-b border-[var(--line)] px-5 py-3">
              <h2 className="eyebrow">Claim code</h2>
            </div>
            <div className="px-5 py-4">
              <p className="tnum text-[2rem] font-semibold leading-none" style={{ letterSpacing: "0.18em", color: "var(--claude)" }} data-testid="claim-code">
                {claimCode.code}
              </p>
              <p className="label mt-3">Read this to the homeowner</p>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--ink-2)]">
                Go to <span className="tnum text-[var(--ink)]">{homeownerAppUrl()}/claim</span> and enter{" "}
                <span className="tnum text-[var(--ink)]">{claimCode.code}</span>. The code works once and expires in{" "}
                {properties.OWNER_INVITE_DAYS} days.
              </p>
            </div>
            <form action={dismissClaimCodeAction} className="border-t border-[var(--line)] px-5 py-4">
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="btn btn-secondary w-full">
                Done, hide the code
              </button>
            </form>
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Homeowner</h2>
          </div>

          {owners.length === 0 ? (
            <p className="label px-4 pt-3.5">Not claimed yet</p>
          ) : (
            <ul>
              {owners.map(({ owner, profile }) => (
                <li key={owner.id} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">{profile.name}</span>
                    <span className="tnum mt-0.5 block truncate text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      @{profile.handle} · since {formatDate(owner.since, { month: "short", year: "numeric" })}
                    </span>
                  </span>
                  <span className="chip chip-accent shrink-0">{OWNER_ROLE_WORD[owner.role]}</span>
                </li>
              ))}
            </ul>
          )}

          <form action={issueClaimCodeAction} className="space-y-3.5 px-4 py-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="propertyId" value={property.id} />
            <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              {owners.length === 0
                ? "The record is the homeowner's to keep. Issue a claim code, read it to them, and the house appears in their own app with everything filmed so far."
                : "Someone else moving in, or a co-owner? Issue a claim code and they join as an owner of the record."}
              {invites.length > 0 && (
                <>
                  {" "}
                  <span className="tnum text-[var(--ink-3)]">
                    {invites.length} code{invites.length === 1 ? "" : "s"} issued, not used yet.
                  </span>
                </>
              )}
            </p>
            <button type="submit" className={`btn w-full ${owners.length === 0 ? "btn-primary" : "btn-secondary"}`}>
              Issue a claim code
            </button>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Who can see this record</h2>
          </div>

          {grants.length === 0 && requests.length === 0 && municipalities.length === 0 ? (
            <p className="label px-4 pt-3.5">No one outside the project yet</p>
          ) : (
            <ul>
              {grants.map((g) => {
                const who = g.granteeOrgId
                  ? (outsideOrgs.get(g.granteeOrgId)?.name ?? "An institution")
                  : (granteePeople.get(g.granteeIdentityId ?? "") ?? "A person");
                return (
                  <li key={g.id} className="border-b border-[var(--line)] px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-medium leading-snug">{who}</span>
                        <span className="tnum mt-0.5 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                          Granted {formatDate(g.createdAt)}
                          {g.expiresAt ? ` · until ${formatDate(g.expiresAt)}` : ""}
                        </span>
                      </span>
                      <ScopeChip scope={g.scope} />
                    </div>
                    {g.purpose && <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{g.purpose}</p>}
                  </li>
                );
              })}
              {requests.map((r) => (
                <li key={r.id} className="border-b border-[var(--line)] px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-medium leading-snug">
                        {outsideOrgs.get(r.requesterOrgId)?.name ?? "An institution"}
                      </span>
                      <span className="tnum mt-0.5 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                        Asked {formatDate(r.createdAt)} · waiting on the owner
                      </span>
                    </span>
                    <span className="chip shrink-0">Asking for {access.SCOPE_LABEL[r.scope].toLowerCase()}</span>
                  </div>
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{r.purpose}</p>
                </li>
              ))}
              {municipalities.map((m) => (
                <li key={m.id} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">{m.name}</span>
                    <span className="tnum mt-0.5 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      Covers {property.city}, {property.state} by statute
                    </span>
                  </span>
                  <ScopeChip scope="ledger" />
                </li>
              ))}
            </ul>
          )}

          <p className="px-4 py-3.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
            Grants are the owner&apos;s to give and take back. Lenders, insurers and brokerages ask the owner from their own app; the
            municipality covering the address reads the ledger by statute.
          </p>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Project team</h2>
          </div>

          {team.length === 0 ? (
            <p className="label px-4 pt-3.5">No companies on this project</p>
          ) : (
            <ul>
              {team.map(({ access: row, org: member }) => (
                <li key={row.id} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">{member.name}</span>
                    {member.headline && <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ink-3)]">{member.headline}</span>}
                  </span>
                  <span className={`chip shrink-0 ${row.role === "owner" ? "chip-accent" : ""}`}>{ROLE_WORD[row.role]}</span>
                </li>
              ))}
            </ul>
          )}

          <form action={addCompanyByKeyAction} className="space-y-3.5 px-4 py-4">
            <input type="hidden" name="recordId" value={record.id} />
            <div>
              <label className="label block" htmlFor="hfxKey">
                Add a company by HomeFAX key
              </label>
              <input
                id="hfxKey"
                name="hfxKey"
                required
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="hfx_…"
                className="input tnum mt-1.5"
              />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                Ask the sub for the key on their Team page. They get to open this record and film the stages you hand them.
              </p>
            </div>
            <button type="submit" className="btn btn-secondary w-full">
              Add company
            </button>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Assignments</h2>
          </div>

          {assignments.length === 0 ? (
            <p className="label px-4 pt-3.5">Nothing assigned on this property</p>
          ) : (
            <ul>
              {assignments.map((a) => (
                <li key={a.id} className="border-b border-[var(--line)] px-4 py-3">
                  <div className="flex items-start gap-3">
                    <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">{a.task}</p>
                    <span className={`chip shrink-0 ${a.status === "open" ? "chip-accent" : ""}`}>{a.status === "open" ? "Open" : "Done"}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="chip">{assigneeName(a.assigneeIdentityId, a.assigneeOrgId)}</span>
                    {a.stage && <span className="chip">{stageDef(a.stage).short}</span>}
                  </div>

                  <form action={setAssignmentStatusAction} className="mt-2.5">
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <input type="hidden" name="status" value={a.status === "open" ? "done" : "open"} />
                    <button type="submit" className="chip min-h-[2.75rem] px-3">
                      {a.status === "open" ? "Mark done" : "Reopen"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {canAssign ? (
            <form action={assignAction} className="space-y-3.5 px-4 py-4">
              <input type="hidden" name="recordId" value={record.id} />
              <div>
                <label className="label block" htmlFor="assignee">
                  Hand it to
                </label>
                <select id="assignee" name="assignee" required className="input mt-1.5">
                  {members.map((m) => (
                    <option key={m.profile.identityId} value={`u:${m.profile.identityId}`}>
                      {m.profile.name}
                      {m.membership.title ? ` · ${m.membership.title}` : ""}
                    </option>
                  ))}
                  {team.map((t) => (
                    <option key={t.org.id} value={`o:${t.org.id}`}>
                      {t.org.name} (company)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="task">
                  The work
                </label>
                <input id="task" name="task" required placeholder="Film the rough electrical before drywall" className="input mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="stage">
                  Stage <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <select id="stage" name="stage" defaultValue="" className="input mt-1.5">
                  <option value="">Not stage-specific</option>
                  {STAGES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary w-full">
                Assign work
              </button>
            </form>
          ) : (
            <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Work goes to a person on your crew or a company on the project. Add members on Team, or add a company by its HomeFAX key above.
            </p>
          )}
        </section>

        {rollup.length > 0 && (
          <details className="group">
            <summary className="card flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="eyebrow block">Materials on the record</span>
                <span className="mt-1 block text-[0.8125rem] leading-snug text-[var(--ink-2)]">Every stage rolled into one list</span>
              </span>
              <span className="tnum shrink-0 text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">{rollup.length} lines</span>
              <svg className="shrink-0 transition-transform duration-150 group-open:rotate-90" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <div className="mt-3">
              <PartsTable
                parts={rollup}
                title="Cumulative takeoff"
                note="One line per material across the whole build. Where a later stage measured what an earlier one estimated, the measured count replaces it rather than ordering twice."
              />
            </div>
          </details>
        )}
      </main>
    </>
  );
}

function ScopeChip({ scope }: { scope: Scope }) {
  return <span className={`chip shrink-0 ${scope === "full" ? "chip-accent" : ""}`}>{access.SCOPE_LABEL[scope]}</span>;
}

function ModelMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label="Model on file">
      <path d="M10 2.6 17 6.5v7L10 17.4 3 13.5v-7L10 2.6Z" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3 6.5 10 10.4l7-3.9M10 10.4v7" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
