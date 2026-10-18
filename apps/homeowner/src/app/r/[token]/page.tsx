import dynamicImport from "next/dynamic";
import Link from "next/link";
import { viewProperty } from "@homefax/app-kit";
import { hashToken } from "@homefax/auth";
import { STAGES, isStageId, stageDef } from "@homefax/core";
import { access, orgs, oversight, properties, records, withService, type Scope } from "@homefax/db";
import { GradeChip, LogoMark, PartsTable, QualityPanel, Wordmark } from "@homefax/ui";
import HouseCard from "@/components/HouseCard";
import StageView from "@/components/StageView";
import { formatDay, formatMoneyCents, plural } from "@/lib/format";
import { addressLine, placeLine, standingLine, ticksForOwner, ticksFromGrades, toPartLines, type Tick } from "@/lib/house";
import { kit } from "@/lib/kit";

const ModelViewer = dynamicImport(() => import("@homefax/ui/model-viewer"));

/**
 * The public report. No sign-in: the token in the URL is the permission. It is
 * resolved once as the service (and counted), then everything is read as an
 * anonymous visitor carrying the token's hash, so row-level security scopes
 * the data to exactly what the owner allowed — summary, ledger, or full.
 *
 * The comb on the house card is the navigation here too: a tick selects a
 * stage (?stage=…) and the page shows that stage's model, ledger and
 * materials below, as far as the link's scope permits.
 */

export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const wanted = Array.isArray(sp.stage) ? sp.stage[0] : sp.stage;

  const resolved = await withService((tx) => access.resolveShareLink(tx, token)).catch(() => null);
  if (!resolved) return <DeadLink />;
  const { link } = resolved;
  const path = `/r/${token.slice(0, 6)}…`;

  const data = await kit.asVisitor(
    async (tx, me, actor) => {
      const property = await properties.getProperty(tx, link.propertyId);
      const stats = await properties.getStats(tx, link.propertyId);
      if (!property || !stats) return null;

      // Owners and grantees are logged by their own path; a visitor with only
      // the link is logged as a share-link look (reach() cannot see the link
      // row under RLS for an anonymous visitor, so the log is written here).
      const view = await viewProperty(tx, property.id, actor, { app: "homeowner", path });
      let scope: Scope = link.scope;
      if (view) scope = view.scope;
      else
        await access.logAccess(tx, {
          propertyId: property.id,
          viewerIdentityId: me?.identity.id ?? null,
          via: "share_link",
          scope: link.scope,
          app: "homeowner",
          path,
          shareLinkId: link.id,
        });

      const grades = await records.listStageGrades(tx, property.id);
      const ledger = access.scopeAtLeast(scope, "ledger");
      const full = access.scopeAtLeast(scope, "full");
      const ticks = ledger ? await ticksForOwner(tx, property.id) : ticksFromGrades(grades);
      const captures = ledger ? await records.listCapturesForProperty(tx, property.id) : [];
      const reviews = ledger ? await oversight.listReviewsForProperty(tx, property.id) : [];
      const parts = full ? toPartLines(await records.listPartLines(tx, property.id)) : [];
      const sharer = link.createdByOrgId ? await orgs.getOrg(tx, link.createdByOrgId) : null;
      const orgNames = await orgs.getOrgsByIds(tx, reviews.map((r) => r.municipalityOrgId));
      return { property, stats, scope, grades, ticks, captures, reviews, parts, sharer, orgNames, isOwner: view?.via === "owner" };
    },
    hashToken(token),
  );
  if (!data) return <DeadLink />;

  const { property, stats, scope, grades, ticks, captures, reviews, parts, sharer, orgNames } = data;
  const ledger = access.scopeAtLeast(scope, "ledger");
  const full = access.scopeAtLeast(scope, "full");

  const gradedTicks = ticks.filter((t) => t.state === "graded");
  const latest = [...grades].sort((a, b) => b.filmedAt.getTime() - a.filmedAt.getTime())[0] ?? null;
  const selected = wanted && isStageId(wanted) ? wanted : latest && isStageId(latest.stage) ? latest.stage : null;
  const selectedDef = selected ? stageDef(selected) : null;
  const capture = selected ? captures.find((c) => c.stage === selected) ?? null : null;
  const selectedReviews = capture ? reviews.filter((r) => r.captureId === capture.id) : [];
  const stageParts = selected ? parts.filter((p) => p.stage === selected) : [];
  const href = (stage: Tick["stage"]) => `/r/${token}?stage=${stage}#stage`;

  return (
    <main className="shell flex flex-1 flex-col space-y-6 py-6">
      <section className="plate overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <LogoMark variant="logo" mode="still" surface="dark" size={36} />
          <Wordmark size={15} tracking={0.16} accent="var(--claude)" />
          <span className="tnum ml-auto text-[0.5625rem] uppercase tracking-[0.16em] text-[var(--ink-3)]">Shared report</span>
        </div>
        <div className="border-t border-[var(--line)]">
          <HouseCard surface="plate" address={addressLine(property)} place={placeLine(property)} standing={standingLine(stats)} ticks={ticks} tickHref={href} />
        </div>
        <p className="border-t border-[var(--line)] px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]" role="status">
          Shared by {sharer ? sharer.name : "the owner"} · <span className="font-medium text-[var(--ink)]">{access.SCOPE_LABEL[scope].toLowerCase()} access</span> ·{" "}
          {link.expiresAt ? `expires ${formatDay(link.expiresAt)}` : "no expiry"}
          {link.label ? ` · “${link.label}”` : ""}
        </p>
      </section>

      <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{access.SCOPE_BLURB[scope]} Every look through this link is written on the owner&apos;s record.</p>

      <section className="card overflow-hidden">
        <dl className="rule-grid grid-cols-3 border-t-0">
          <div className="field">
            <dt>Stages graded</dt>
            <dd>
              {gradedTicks.length} / {stats.stagesTotal}
            </dd>
          </div>
          <div className="field">
            <dt>Points passed</dt>
            <dd>{stats.pointsAssessed > 0 ? `${stats.pointsPassed} / ${stats.pointsAssessed}` : "—"}</dd>
          </div>
          <div className="field">
            <dt>{full ? "Materials" : "Open safety"}</dt>
            <dd>{full ? (stats.materialsLines > 0 ? formatMoneyCents(stats.materialsTotalCents) : "—") : stats.openSafetyItems}</dd>
          </div>
        </dl>
        <p className="border-t border-[var(--line)] px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          {stats.pointsAssessed > 0 ? `${stats.pointsPassed} of the ${stats.pointsAssessed} ledger points assessed so far passed. ` : "No ledger points have been assessed yet. "}
          {stats.openSafetyItems > 0 ? `${plural(stats.openSafetyItems, "safety point is", "safety points are")} still failing or flagged.` : "No safety point is failing or flagged."}
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="eyebrow">Grade per stage</h2>
        </div>
        <ol>
          {ticks.map((t, i) => (
            <li key={t.stage} className="border-b border-[var(--line)] last:border-b-0">
              <Link href={href(t.stage)} aria-current={t.stage === selected ? "true" : undefined} className="flex min-h-[3rem] items-center gap-3 px-4 py-2" style={t.stage === selected ? { background: "var(--surface-2)" } : undefined}>
                <span className="tnum w-6 shrink-0 text-[0.6875rem] text-[var(--ink-3)]">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-medium leading-snug">{t.label}</span>
                  <span className="tnum block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                    {t.state === "graded" ? `${Math.round(t.score ?? 0)}/100` : t.state === "working" ? "Being built" : t.state === "done" ? "On file" : "Not filmed"}
                  </span>
                </span>
                {t.grade && <GradeChip grade={t.grade} size="sm" />}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {selectedDef && (
        <section id="stage" className="space-y-6">
          <div>
            <p className="eyebrow">Stage {String(STAGES.findIndex((s) => s.id === selected) + 1).padStart(2, "0")} of {STAGES.length}</p>
            <h2 className="mt-1 text-[1.375rem] font-semibold leading-tight">{selectedDef.label}</h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{selectedDef.blurb}</p>
          </div>

          {ledger ? (
            <StageView
              readerIsOwner={false}
              capture={capture}
              def={selectedDef}
              reviews={selectedReviews.map((r) => ({ ...r, orgName: orgNames.get(r.municipalityOrgId)?.name ?? "The municipality" }))}
              viewer={capture?.state === "done" && capture.glbUrl ? <ModelViewer url={capture.glbUrl} className="h-[68vw] max-h-[24rem] w-full" /> : null}
              quality={capture?.state === "done" && capture.quality ? <QualityPanel report={capture.quality} stageLabel={selectedDef.label} /> : null}
              parts={full && capture?.state === "done" ? <PartsTable parts={stageParts} title="What was put in" /> : null}
            />
          ) : (
            <section className="card px-4 py-4">
              <h3 className="eyebrow">Summary access</h3>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                {latest && latest.stage === selected
                  ? `This stage was graded ${latest.grade} (${Math.round(latest.score)} of 100) on ${formatDay(latest.filmedAt)}.`
                  : "The grade for this stage is above."}{" "}
                The model, every checked point and the findings need ledger access — ask the owner for a wider link.
              </p>
            </section>
          )}
        </section>
      )}

      {full && parts.length > 0 && (
        <PartsTable parts={parts} title="Everything in the walls" note="Every material line across every stage, at list prices." />
      )}

      <p className="eyebrow pb-2 text-center">A HomeFAX record · read-only · {formatDay(new Date())}</p>
    </main>
  );
}

function DeadLink() {
  return (
    <main className="shell flex flex-1 flex-col items-center justify-center py-16">
      <section className="plate w-full overflow-hidden">
        <div className="flex flex-col items-center px-5 pb-6 pt-7">
          <LogoMark variant="logo" mode="still" surface="dark" size={96} />
          <h1 className="mt-3 text-center text-[1.25rem] font-semibold leading-tight">This link no longer opens</h1>
          <p className="mt-2 text-center text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            It has expired, or the owner revoked it. Ask them for a new one — a link is theirs to give.
          </p>
          <Link href="/" className="btn btn-secondary mt-5">
            HomeFAX
          </Link>
        </div>
      </section>
    </main>
  );
}
