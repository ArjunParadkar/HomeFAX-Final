import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ErrorLine from "@/components/ErrorLine";
import PartsTable from "@/components/PartsTable";
import { GradeChip } from "@/components/Grade";
import {
  addCompanyByKeyAction,
  assignAction,
  setAssignmentStatusAction,
} from "@/app/account/actions";
import {
  activeOrg,
  canAccessRecord,
  currentUser,
  listAssignmentsForRecord,
  listMembers,
  listProjectOrgs,
} from "@/lib/accounts";
import { cumulativeParts } from "@/lib/parts";
import { STAGES, stageDef } from "@/lib/stages";
import { getRecordBySlug, listCaptures } from "@/lib/store";

export const dynamic = "force-dynamic";

const IN_FLIGHT = new Set([
  "queued",
  "extracting",
  "registering",
  "reconstructing",
  "meshing",
  "analyzing",
]);

const ROLE_WORD: Record<"owner" | "collaborator", string> = {
  owner: "Owner",
  collaborator: "Collaborator",
};

export default async function RecordPage({ params, searchParams }: PageProps<"/records/[slug]">) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { slug } = await params;
  const sp = await searchParams;
  const record = await getRecordBySlug(slug);
  if (!record) notFound();
  if (!(await canAccessRecord(user.id, record.id))) redirect("/records");

  const org = await activeOrg(user.id);

  const captures = await listCaptures(record.id);
  const byStage = new Map(captures.map((c) => [c.stage, c]));
  const recorded = captures.filter((c) => c.state === "done").length;

  // Ledger totals across every stage that has been assessed. Summed, never
  // averaged — a point is passed on a stage or it is not.
  let passed = 0;
  let assessed = 0;
  for (const c of captures) {
    const q = c.quality;
    if (!q?.checkpoints?.length) continue;
    passed += q.checkpointsPassed ?? q.checkpoints.filter((p) => p.status === "pass").length;
    assessed +=
      q.checkpointsAssessed ?? q.checkpoints.filter((p) => p.status !== "not_assessable").length;
  }

  const rollup = cumulativeParts(
    captures
      .filter((c) => c.state === "done" && c.parts.length > 0)
      .map((c) => ({ stage: c.stage, parts: c.parts })),
  );

  // The parties on this record, and who work can be handed to: the reader's
  // own crew by name, or any company already on the project.
  const team = await listProjectOrgs(record.id);
  const members = org ? await listMembers(org.id) : [];
  const assignments = await listAssignmentsForRecord(record.id);

  const memberNames = new Map(members.map((m) => [m.user.id, m.user.name]));
  const teamNames = new Map(team.map((t) => [t.org.id, t.org.name]));

  const readerId = user.id;
  function assigneeName(userId: string | null, orgId: string | null): string {
    if (userId) return userId === readerId ? "You" : (memberNames.get(userId) ?? "A person");
    if (orgId) return teamNames.get(orgId) ?? "A company";
    return "Unassigned";
  }

  const canAssign = members.length > 0 || team.length > 0;

  return (
    <>
      <AppHeader
        back={{ href: "/records", label: "On file" }}
        eyebrow="Build record"
        title={record.address}
        subtitle={record.owner ? `Held for ${record.owner}` : (record.contractor ?? undefined)}
        meta={`${String(recorded).padStart(2, "0")}/${STAGES.length}`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        <section className="card overflow-hidden">
          <dl className="rule-grid grid-cols-2 border-t-0">
            <div className="field">
              <dt>Opened</dt>
              <dd>{formatDate(record.createdAt)}</dd>
            </div>
            <div className="field">
              <dt>Stages on file</dt>
              <dd>
                {recorded} / {STAGES.length}
              </dd>
            </div>
            <div className="field">
              <dt>Points passed</dt>
              <dd>{assessed > 0 ? `${passed} / ${assessed}` : "—"}</dd>
            </div>
            <div className="field">
              <dt>Filed by</dt>
              <dd className="truncate">{record.contractor ?? org?.name ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="eyebrow">The sequence</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Stages close in order and never reopen. Tap one to film it, or to read what is already
            on the record.
          </p>

          <ol className="mt-3">
            {STAGES.map((stage, i) => {
              const capture = byStage.get(stage.id);
              const state = capture?.state;
              const done = state === "done";
              const working = state != null && IN_FLIGHT.has(state);
              const grade = capture?.quality?.grade;
              return (
                <li key={stage.id} className="rail relative pb-1.5">
                  <Link
                    href={`/records/${record.slug}/stages/${stage.id}`}
                    className="flex min-h-[3.25rem] items-center gap-3.5 py-2"
                  >
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
                      <span className="block text-[0.9375rem] font-medium leading-snug">
                        {stage.label}
                      </span>
                      <span className="tnum block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                        {done
                          ? "Model on file"
                          : state === "failed"
                            ? "Failed — refilm"
                            : working
                              ? "Building model"
                              : "Not filmed"}
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

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Project team</h2>
          </div>

          {team.length === 0 ? (
            <p className="label px-4 pt-3.5">No companies on this project</p>
          ) : (
            <ul>
              {team.map(({ access, org: member }) => (
                <li
                  key={access.id}
                  className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium leading-snug">
                      {member.name}
                    </span>
                    {member.headline && (
                      <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ink-3)]">
                        {member.headline}
                      </span>
                    )}
                  </span>
                  <span
                    className={`chip shrink-0 ${access.role === "owner" ? "chip-accent" : ""}`}
                  >
                    {ROLE_WORD[access.role]}
                  </span>
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
                Ask the sub for the key on their Team page. They get to open this record and film
                the stages you hand them.
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
                    <p className="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">
                      {a.task}
                    </p>
                    <span className={`chip shrink-0 ${a.status === "open" ? "chip-accent" : ""}`}>
                      {a.status === "open" ? "Open" : "Done"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="chip">{assigneeName(a.assigneeUserId, a.assigneeOrgId)}</span>
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
                    <option key={m.user.id} value={`u:${m.user.id}`}>
                      {m.user.name}
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
                <input
                  id="task"
                  name="task"
                  required
                  placeholder="Film the rough electrical before drywall"
                  className="input mt-1.5"
                />
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
              Work goes to a person on your crew or a company on the project. Add members on Team,
              or add a company by its HomeFAX key above.
            </p>
          )}
        </section>

        {rollup.length > 0 && (
          <details className="group">
            <summary className="card flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="eyebrow block">Materials on the record</span>
                <span className="mt-1 block text-[0.8125rem] leading-snug text-[var(--ink-2)]">
                  Every stage rolled into one list
                </span>
              </span>
              <span className="tnum shrink-0 text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
                {rollup.length} lines
              </span>
              <svg
                className="shrink-0 transition-transform duration-150 group-open:rotate-90"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <path
                  d="m6 3.5 4.5 4.5L6 12.5"
                  stroke="var(--ink-3)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ModelMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label="Model on file">
      <path
        d="M10 2.6 17 6.5v7L10 17.4 3 13.5v-7L10 2.6Z"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 6.5 10 10.4l7-3.9M10 10.4v7" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
