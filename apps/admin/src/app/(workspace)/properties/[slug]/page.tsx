import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorLine, GradeChip, PartsTable, QualityPanel } from "@homefax/ui";
import { STAGES, isStageId, stageDef, toGrade, type PartLine, type QualityReport } from "@homefax/core";
import { viewProperty } from "@homefax/app-kit";
import { access, oversight, orgs, properties, records, type PartLineRow } from "@homefax/db";
import { decideDrawAction, requestDrawAction } from "@/app/(workspace)/portfolio/actions";
import { updatePolicyStatusAction } from "@/app/(workspace)/policies/actions";
import { Comb, DRAW_TONE, PERMIT_TONE, POLICY_TONE, RiskWord, StatusWord, VERDICT_TONE, VERDICT_WORD } from "@/components/bits";
import ModelPlate from "@/components/ModelPlate";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { cityOf, date, dateTime, masked, money, plural, score, streetOf, titleWord } from "@/lib/format";
import { asWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const SEVERITY_COLOR = { critical: "var(--grade-f)", major: "var(--grade-d)", minor: "var(--grade-c)", info: "var(--ink-3)" } as const;
const CATEGORY_LABEL: Record<string, string> = { structure: "Structure", envelope: "Envelope", moisture: "Moisture", mechanical: "Mechanical", surfaces: "Surfaces", safety: "Safety", capture: "Record integrity" };
const VIA_WORD = { owner: "as the owner", project: "as a party to the build record", grant: "by grant", jurisdiction: "by jurisdiction", share_link: "by share link", service: "as the platform" } as const;

/**
 * The house, at the institution's scope. viewProperty first — it logs the look
 * and 404s what the actor may not see. Tabs are a query parameter so the page
 * stays a server component and the back button walks them.
 */
export default async function PropertyPage({ params, searchParams }: PageProps<"/properties/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const stageRaw = Array.isArray(sp.stage) ? sp.stage[0] : sp.stage;

  const data = await asWorkspace(async (tx, ws) => {
    const home = await properties.getPropertyBySlug(tx, slug);
    if (!home) return null;
    const view = await viewProperty(tx, home.id, { identityId: ws.me.identity.id }, { app: "admin", path: `/properties/${slug}`, orgId: ws.org.id });
    if (!view) return null;
    const scope = view.scope;
    const ledger = access.scopeAtLeast(scope, "ledger");
    const full = access.scopeAtLeast(scope, "full");

    const stats = (await properties.getStats(tx, home.id))!;
    const grades = await records.listStageGrades(tx, home.id);
    const stages = ledger ? await records.stageStatuses(tx, home.id) : null;
    const reviews = ledger ? await oversight.listReviewsForProperty(tx, home.id) : [];
    const permits = await oversight.listPermitsForProperty(tx, home.id);
    const events = await properties.listEvents(tx, home.id, 60);
    const grants = (await access.listGrants(tx, home.id)).filter((g) => g.granteeOrgId === ws.org.id);
    const captures = ledger ? await records.listCapturesForProperty(tx, home.id) : [];
    const findings = ledger ? await records.listFindings(tx, home.id) : [];
    const parts = full ? await records.listPartLines(tx, home.id) : [];
    const owners = await properties.listOwners(tx, home.id);
    const buildRecords = await records.listRecordsForProperty(tx, home.id);
    const reviewerOrgs = await orgs.getOrgsByIds(tx, reviews.map((r) => r.municipalityOrgId));
    const actorIds = [...new Set([...events.map((e) => e.actorId), ...grants.map((g) => g.grantedBy)].filter((x): x is string => Boolean(x)))];
    const names = await records.namesFor(tx, actorIds);

    const kind = ws.org.kind;
    const holdings = kind === "lender" ? (await oversight.listHoldings(tx, ws.org.id)).filter((h) => h.property.id === home.id) : [];
    const draws = kind === "lender" ? await oversight.listDrawsForProperty(tx, home.id) : [];
    const live = new Map<string, oversight.DrawRecommendation>();
    for (const d of draws) if (d.status === "requested") live.set(d.id, await oversight.recommendDraw(tx, home.id, d.stage));
    const policies = kind === "insurer" ? (await oversight.listPolicies(tx, ws.org.id)).filter((p) => p.property.id === home.id) : [];
    const breakdown = kind === "insurer" && ledger ? await oversight.categoryBreakdown(tx, home.id) : [];
    const listings = kind === "brokerage" ? (await oversight.listListings(tx, ws.org.id)).filter((l) => l.property.id === home.id) : [];

    return { ws, home, view, scope, ledger, full, stats, grades, stages, reviews, permits, events, grants, captures, findings, parts, owners, buildRecords, reviewerOrgs, names, holdings, draws, live, policies, breakdown, listings };
  });
  if (!data) notFound();

  const { ws, home, view, scope, ledger, full, stats, grades, reviews, permits, events, grants, captures, findings, parts, owners } = data;
  const kind = ws.org.kind;
  const risk = oversight.riskProfile(stats);
  const gradeByStage = new Map(grades.map((g) => [g.stage, g]));
  const reviewByCapture = new Map(reviews.map((r) => [r.captureId, r]));
  const captureByStage = new Map(captures.map((c) => [c.stage, c]));

  const tabs: { id: string; label: string }[] = [{ id: "overview", label: "Overview" }];
  if (ledger) tabs.push({ id: "ledger", label: "Ledger" }, { id: "findings", label: `Findings · ${findings.length}` }, { id: "models", label: "Models" });
  if (full) tabs.push({ id: "materials", label: "Materials" });
  tabs.push({ id: "permits", label: `Permits · ${permits.length}` });
  if (kind === "lender") tabs.push({ id: "draws", label: `Draws · ${data.draws.length}` });
  if (kind === "insurer") tabs.push({ id: "policies", label: `Policies · ${data.policies.length}` }, { id: "underwriting", label: "Underwriting" });
  if (kind === "brokerage") tabs.push({ id: "listing", label: "Listing" });
  tabs.push({ id: "timeline", label: "Timeline" });
  const tab = tabs.some((t) => t.id === tabRaw) ? tabRaw! : "overview";
  const href = (t: string) => `/properties/${home.slug}?tab=${t}`;

  const myGrant = grants.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const accessLine =
    view.via === "grant" && myGrant
      ? `You see this house by grant (${access.SCOPE_LABEL[scope].toLowerCase()}) · granted ${date(myGrant.createdAt)} by ${data.names.get(myGrant.grantedBy ?? "") ?? "the owner"}${myGrant.expiresAt ? ` · expires ${date(myGrant.expiresAt)}` : ""}`
      : `You see this house ${VIA_WORD[view.via]} (${access.SCOPE_LABEL[scope].toLowerCase()})`;

  return (
    <>
      <PageTitle
        eyebrow={`Property · ${home.kind.replace("_", " ")}${home.yearBuilt ? ` · ${home.yearBuilt}` : ""}`}
        title={streetOf(home)}
        subtitle={
          <>
            {cityOf(home)}
            {owners.length > 0 && <> · held by {owners.map((o) => o.profile.name).join(", ")}</>}
            {data.buildRecords[0]?.contractorName && <> · built by {data.buildRecords[0].contractorName}</>}
          </>
        }
        actions={
          <>
            {stats.meanScore != null && <GradeChip grade={toGrade(stats.meanScore)} />}
            <RiskWord band={risk.band} />
            <Link href="/properties" className="btn btn-secondary btn-sm">
              Back to the board
            </Link>
          </>
        }
      />
      <ErrorLine message={sp.error} className="mb-4" />

      <p className="mb-5 text-[0.75rem] text-[var(--ink-3)]">
        <span className="chip chip-accent mr-2">{access.SCOPE_LABEL[scope]}</span>
        {accessLine}. This look is on the owner&apos;s access log.
      </p>

      <dl className="rule-grid grid-cols-2 overflow-hidden rounded-[var(--radius)] border border-[var(--line)] md:grid-cols-4 xl:grid-cols-8">
        <Field term="Stages on file" value={`${stats.stagesFilmed} / ${stats.stagesTotal}`} />
        <Field term="Mean score" value={score(stats.meanScore)} />
        <Field term="Latest stage" value={stats.latestStage && isStageId(stats.latestStage) ? stageDef(stats.latestStage).short : "—"} />
        <Field term="Points passed" value={stats.pointsAssessed ? `${stats.pointsPassed} / ${stats.pointsAssessed}` : "—"} />
        <Field term="Open findings" value={`${stats.criticalFindings} crit · ${stats.majorFindings} maj`} />
        <Field term="Safety · moisture" value={`${stats.openSafetyItems} · ${stats.openMoistureItems}`} />
        <Field term="Verified · flagged" value={`${stats.verifiedStages} · ${stats.flaggedStages}`} />
        <Field term="Last filmed" value={date(stats.lastCaptureAt)} />
      </dl>
      <Comb grades={grades} className="mt-3" />

      <nav aria-label="Sections" className="tabs mt-6 mb-5">
        {tabs.map((t) => (
          <Link key={t.id} href={href(t.id)} className="tab" aria-current={t.id === tab ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel title="Stages" meta={`${grades.length} graded`} flush>
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Stage</th>
                    <th>Grade</th>
                    <th className="num">Score</th>
                    <th className="num">Points</th>
                    <th>Filmed</th>
                    <th>Municipality verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGES.map((s, i) => {
                    const g = gradeByStage.get(s.id);
                    const st = data.stages?.find((x) => x.stage === s.id);
                    const rv = g ? reviewByCapture.get(g.captureId) : undefined;
                    return (
                      <tr key={s.id} className={g ? "" : "text-[var(--ink-3)]"}>
                        <td className="mono">{String(i + 1).padStart(2, "0")}</td>
                        <td className={g ? "font-medium" : ""}>{s.label}</td>
                        <td>{g ? <GradeChip grade={g.grade} size="sm" /> : st?.state === "working" ? <span className="chip">Building</span> : st?.state === "failed" ? <span className="chip">Failed</span> : "—"}</td>
                        <td className="num">{score(g?.score)}</td>
                        <td className="num">{g ? `${g.checkpointsPassed} / ${g.checkpointsAssessed}` : "—"}</td>
                        <td className="mono">{date(g?.filmedAt)}</td>
                        <td>
                          {rv ? (
                            <StatusWord tone={VERDICT_TONE[rv.verdict]}>
                              {VERDICT_WORD[rv.verdict]} · {data.reviewerOrgs.get(rv.municipalityOrgId)?.name ?? "municipality"}
                            </StatusWord>
                          ) : g ? (
                            <span className="text-[var(--ink-3)]">{ledger ? "Not reviewed" : "—"}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="space-y-5">
            <Panel title="Risk profile" meta={risk.score != null ? `${risk.score} / 100` : undefined}>
              <RiskWord band={risk.band} />
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                {risk.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-3 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">Deterministic and explainable: every point comes from a named fact on the record. Not a credit score.</p>
            </Panel>
            <Panel title="Who may see it" meta={`${access.SCOPE_LABEL[scope]}`}>
              <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{accessLine}.</p>
              {!ledger && (
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                  Summary scope shows the grades and the stats. <Link href="/properties" className="underline">Ask the owner for ledger access</Link> to read the 50-point ledger, the findings, and the models.
                </p>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "ledger" && ledger && (
        <div className="space-y-4">
          {captures.filter((c) => c.quality).length === 0 ? (
            <Panel title="Ledger">
              <Empty>No stage has been graded yet.</Empty>
            </Panel>
          ) : (
            captures
              .filter((c) => c.quality)
              .map((c) => (
                <details key={c.id} className="card overflow-hidden" open={captures.filter((x) => x.quality).length === 1}>
                  <summary className="flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
                    <GradeChip grade={c.quality!.grade} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-medium">{stageDef(c.stage).label}</span>
                      <span className="tnum block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                        {Math.round(c.quality!.score)}/100 · {c.quality!.checkpointsPassed ?? 0} of {c.quality!.checkpointsAssessed ?? 0} points · filmed {date(c.createdAt)}
                      </span>
                    </span>
                    <svg className="shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div className="border-t border-[var(--line)] p-4">
                    <QualityPanel report={c.quality as QualityReport} stageLabel={stageDef(c.stage).label} />
                  </div>
                </details>
              ))
          )}
        </div>
      )}

      {tab === "findings" && ledger && (
        <Panel title="Open findings" meta={plural(findings.length, "finding")} flush>
          {findings.length === 0 ? (
            <Empty>Nothing open. Every finding the grading raised has been resolved, or none was raised.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Stage</th>
                    <th>Finding</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <span className="chip" style={{ color: SEVERITY_COLOR[f.severity], borderColor: `color-mix(in oklab, ${SEVERITY_COLOR[f.severity]} 55%, transparent)` }}>
                          {f.severity}
                        </span>
                      </td>
                      <td>{stageDef(f.stage).short}</td>
                      <td>
                        <span className="block font-medium">{f.title}</span>
                        <span className="text-[var(--ink-2)]">{f.detail}</span>
                      </td>
                      <td className="text-[var(--ink-3)]">
                        {f.source}
                        {f.keyframeIndex != null ? ` · frame ${f.keyframeIndex + 1}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === "models" && ledger && (() => {
        const done = captures.filter((c) => c.state === "done" && c.glbUrl);
        const chosen = (stageRaw && isStageId(stageRaw) ? captureByStage.get(stageRaw) : undefined) ?? done[done.length - 1];
        return (
          <div className="space-y-4">
            <nav aria-label="Stage models" className="flex flex-wrap gap-1.5">
              {done.map((c) => (
                <Link key={c.id} href={`${href("models")}&stage=${c.stage}`} className={`chip min-h-[2rem] px-2.5 ${chosen?.id === c.id ? "chip-accent" : ""}`} aria-current={chosen?.id === c.id ? "page" : undefined}>
                  {stageDef(c.stage).short}
                </Link>
              ))}
            </nav>
            {chosen?.glbUrl ? (
              <ModelPlate url={chosen.glbUrl} stageLabel={stageDef(chosen.stage).label} simulated={chosen.glbUrl.startsWith("procedural://") || Boolean(gradeByStage.get(chosen.stage)?.simulated)} filmed={date(chosen.createdAt)} />
            ) : (
              <Panel title="Models">
                <Empty>No model is on file yet. Models appear as stages are filmed and reconstructed.</Empty>
              </Panel>
            )}
          </div>
        );
      })()}

      {tab === "materials" && full && (
        <PartsTable parts={parts.map(toPartLine)} title="Materials on the record" note="Every stage's takeoff, one line per material. Quantities come off the model or the footage; the basis is printed on each line." />
      )}

      {tab === "permits" && (
        <Panel title="Permits" meta={kind === "municipality" ? <Link href="/permits" className="underline">Manage permits</Link> : undefined} flush>
          {permits.length === 0 ? (
            <Empty>No permit on file for this house.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Permit</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Applied</th>
                    <th>Issued</th>
                    <th>Closed</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((p) => (
                    <tr key={p.id}>
                      <td className="mono font-medium">{p.permitNo}</td>
                      <td>{titleWord(p.kind)}</td>
                      <td>
                        <StatusWord tone={PERMIT_TONE[p.status]}>{titleWord(p.status)}</StatusWord>
                      </td>
                      <td className="mono">{date(p.appliedAt)}</td>
                      <td className="mono">{date(p.issuedAt)}</td>
                      <td className="mono">{date(p.closedAt)}</td>
                      <td className="text-[var(--ink-2)]">{p.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === "draws" && kind === "lender" && (
        <div className="space-y-5">
          <Panel title="Draws on this house" meta={plural(data.draws.length, "draw")} flush>
            {data.draws.length === 0 ? (
              <Empty>No draw has been requested against this house.</Empty>
            ) : (
              <div className="ledger-wrap">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                      <th>Record says</th>
                      <th>Requested</th>
                      <th>Decided</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.draws.map((d) => {
                      const live = data.live.get(d.id);
                      return (
                        <tr key={d.id}>
                          <td className="font-medium">{stageDef(d.stage).label}</td>
                          <td className="num">{money(d.amountCents)}</td>
                          <td>
                            <StatusWord tone={DRAW_TONE[d.status]}>{titleWord(d.status)}</StatusWord>
                          </td>
                          <td className="max-w-[20rem] text-[var(--ink-2)]">{live ? `${live.recommendation}: ${live.reasons[0]}` : d.recommendation?.split(";")[0] ?? "—"}</td>
                          <td className="mono">{date(d.requestedAt)}</td>
                          <td className="mono">{date(d.decidedAt)}</td>
                          <td className="num">
                            {d.status === "requested" ? (
                              <form action={decideDrawAction} className="flex justify-end gap-1.5">
                                <input type="hidden" name="drawId" value={d.id} />
                                <input type="hidden" name="back" value={href("draws")} />
                                <button type="submit" name="status" value="released" className="btn btn-primary btn-sm">
                                  Release
                                </button>
                                <button type="submit" name="status" value="held" className="btn btn-secondary btn-sm">
                                  Hold
                                </button>
                              </form>
                            ) : (
                              <Link href={`/draws/${d.id}`} className="underline">
                                Detail
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {data.holdings[0] ? (
            <Panel title="Record a draw request" meta={`Holding ${masked(oversight.dec(data.holdings[0].row.loanRefEnc))} · ${money(data.holdings[0].row.principalCents)}`}>
              <form action={requestDrawAction} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
                <input type="hidden" name="holdingId" value={data.holdings[0].row.id} />
                <input type="hidden" name="back" value={href("draws")} />
                <div>
                  <label className="label block" htmlFor="draw-stage">
                    Stage funded
                  </label>
                  <select id="draw-stage" name="stage" className="input input-sm select mt-1.5">
                    {STAGES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label block" htmlFor="draw-amount">
                    Amount
                  </label>
                  <input id="draw-amount" name="amount" required inputMode="decimal" placeholder="$ 25,000" className="input input-sm tnum mt-1.5" />
                </div>
                <button type="submit" className="btn btn-secondary btn-sm">
                  Record request
                </button>
              </form>
            </Panel>
          ) : (
            <p className="text-[0.8125rem] text-[var(--ink-2)]">
              This institution holds no loan on this house. <Link href="/portfolio" className="underline">Add a holding</Link> to record draws against it.
            </p>
          )}
        </div>
      )}

      {tab === "policies" && kind === "insurer" && (
        <Panel title="Policies on this house" meta={<Link href="/policies" className="underline">All policies</Link>} flush>
          {data.policies.length === 0 ? (
            <Empty>
              No policy on this house. <Link href={`/policies?property=${home.id}`} className="underline">Quote one</Link>.
            </Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th className="num">Coverage</th>
                    <th className="num">Premium</th>
                    <th>Effective</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.policies.map((p) => (
                    <tr key={p.row.id}>
                      <td className="font-medium">{titleWord(p.row.kind)}</td>
                      <td className="mono">{masked(oversight.dec(p.row.policyRefEnc))}</td>
                      <td>
                        <StatusWord tone={POLICY_TONE[p.row.status]}>{titleWord(p.row.status)}</StatusWord>
                      </td>
                      <td className="num">{money(p.row.coverageCents)}</td>
                      <td className="num">{money(p.row.premiumCents)}</td>
                      <td className="mono">
                        {date(p.row.effectiveFrom)} – {date(p.row.effectiveTo)}
                      </td>
                      <td className="num">
                        <form action={updatePolicyStatusAction} className="flex justify-end gap-1.5">
                          <input type="hidden" name="policyId" value={p.row.id} />
                          <input type="hidden" name="back" value={href("policies")} />
                          <select name="status" defaultValue={p.row.status} className="input input-sm select w-auto" aria-label="New status">
                            {["quoted", "bound", "active", "lapsed", "cancelled"].map((s) => (
                              <option key={s} value={s}>
                                {titleWord(s)}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn btn-secondary btn-sm">
                            Set
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === "underwriting" && kind === "insurer" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Panel title="Ledger by category" meta={ledger ? `${stats.pointsPassed} / ${stats.pointsAssessed} passed` : "Needs ledger scope"} flush>
            {!ledger ? (
              <Empty>The category breakdown needs ledger scope. Ask the owner for it from the Properties page.</Empty>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Pass</th>
                    <th className="num">Attention</th>
                    <th className="num">Fail</th>
                    <th className="num">No data</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((r) => (
                    <tr key={r.category}>
                      <td className="font-medium">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                      <td className="num" style={{ color: "var(--grade-a)" }}>
                        {r.pass}
                      </td>
                      <td className="num" style={{ color: r.attention ? "var(--grade-c)" : undefined }}>
                        {r.attention}
                      </td>
                      <td className="num" style={{ color: r.fail ? "var(--grade-f)" : undefined }}>
                        {r.fail}
                      </td>
                      <td className="num text-[var(--ink-3)]">{r.notAssessable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Open findings" meta={plural(findings.length, "finding")} flush>
            {findings.length === 0 ? (
              <Empty>{ledger ? "Nothing open on the record." : "Findings need ledger scope."}</Empty>
            ) : (
              <ul>
                {findings.map((f) => (
                  <li key={f.id} className="border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip" style={{ color: SEVERITY_COLOR[f.severity], borderColor: `color-mix(in oklab, ${SEVERITY_COLOR[f.severity]} 55%, transparent)` }}>
                        {f.severity}
                      </span>
                      <span className="chip">{stageDef(f.stage).short}</span>
                      <span className="chip">{f.dimension}</span>
                    </div>
                    <p className="mt-1.5 text-[0.875rem] font-medium leading-snug">{f.title}</p>
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{f.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === "listing" && kind === "brokerage" && (
        <Panel title="Listing" meta={<Link href="/listings" className="underline">All listings</Link>} flush>
          {data.listings.length === 0 ? (
            <Empty>
              This house is not listed by {ws.org.name}. <Link href={`/listings?property=${home.id}`} className="underline">Create the listing</Link>.
            </Empty>
          ) : (
            <ul>
              {data.listings.map((l) => (
                <li key={l.row.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {money(l.row.listPriceCents)} · {titleWord(l.row.status)}
                    </span>
                    <span className="text-[0.75rem] text-[var(--ink-3)]">
                      {l.row.mlsRef ? `MLS ${l.row.mlsRef} · ` : ""}listed {date(l.row.listedAt)} · {l.row.shareLinkId ? "buyer report issued" : "no buyer report yet"}
                    </span>
                  </span>
                  <Link href={`/listings/${l.row.id}`} className="btn btn-secondary btn-sm">
                    Open listing
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "timeline" && (
        <Panel title="Timeline" meta={`${events.length} events at ${access.SCOPE_LABEL[scope].toLowerCase()} scope`} flush>
          {events.length === 0 ? (
            <Empty>Nothing on the timeline at this scope.</Empty>
          ) : (
            <ol>
              {events.map((e) => (
                <li key={e.id} className="flex gap-4 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                  <span className="mono w-[9.5rem] shrink-0 text-[0.75rem] text-[var(--ink-3)]">{dateTime(e.at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.875rem] font-medium leading-snug">{e.title}</span>
                    {e.detail && <span className="block text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{e.detail}</span>}
                    <span className="tnum block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      {e.kind.replace(/_/g, " ")}
                      {e.stage && isStageId(e.stage) ? ` · ${stageDef(e.stage).short}` : ""}
                      {e.actorId && data.names.get(e.actorId) ? ` · ${data.names.get(e.actorId)}` : ""} · {e.visibility}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

    </>
  );
}

function Field({ term, value }: { term: string; value: string }) {
  return (
    <div className="field">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function toPartLine(r: PartLineRow): PartLine {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category as PartLine["category"],
    spec: r.spec ?? undefined,
    quantity: r.quantity,
    unit: r.unit as PartLine["unit"],
    basis: r.basis,
    derivation: r.derivation,
    confidence: r.confidence,
    unitCostUsd: r.unitCostCents != null ? r.unitCostCents / 100 : undefined,
    stage: r.stage,
    identified: r.identified ?? undefined,
  };
}

