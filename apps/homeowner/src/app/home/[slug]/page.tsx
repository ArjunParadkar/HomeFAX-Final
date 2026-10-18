import Link from "next/link";
import { notFound } from "next/navigation";
import { isStageId, stageDef } from "@homefax/core";
import { access, orgs, properties, records } from "@homefax/db";
import { ErrorLine, GradeStamp } from "@homefax/ui";
import AppHeader from "@/components/AppHeader";
import HouseCard from "@/components/HouseCard";
import StageRail from "@/components/StageRail";
import Timeline from "@/components/Timeline";
import { formatMoneyCents, gradeReading, plural } from "@/lib/format";
import { addressLine, openHouse, placeLine, standingLine, ticksForOwner } from "@/lib/house";
import { kit } from "@/lib/kit";

/**
 * The house. The card at the top is the navigation; the stamp says how the
 * latest stage came out and what that means; three ruled fields count what is
 * on file; the timeline tells the story; the rail walks the sequence.
 */

export const dynamic = "force-dynamic";

export default async function HousePage({ params, searchParams }: PageProps<"/home/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;

  const data = await kit.asMe(async (tx, me) => {
    const house = await openHouse(tx, me.identity.id, slug, `/home/${slug}`);
    if (!house) return null;
    const { property, stats } = house;
    const [ticks, grades, events, pending] = await Promise.all([
      ticksForOwner(tx, property.id),
      records.listStageGrades(tx, property.id),
      properties.listEvents(tx, property.id, 10),
      access.listRequestsForProperty(tx, property.id, "pending"),
    ]);
    const orgNames = await orgs.getOrgsByIds(tx, pending.map((p) => p.requesterOrgId));
    return { property, stats, ticks, grades, events, pending, orgNames };
  });
  if (!data) notFound();

  const { property, stats, ticks, grades, events, pending, orgNames } = data;
  const latest = [...grades].sort((a, b) => b.filmedAt.getTime() - a.filmedAt.getTime())[0] ?? null;
  const latestDef = latest && isStageId(latest.stage) ? stageDef(latest.stage) : null;
  const filmed = ticks.filter((t) => t.state === "graded" || t.state === "done").length;
  const base = `/home/${slug}`;

  return (
    <>
      <AppHeader back={{ href: "/home", label: "Your homes" }} meta={`${String(filmed).padStart(2, "0")}/${stats.stagesTotal} stages`} />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />
        {sp.claimed === "1" && (
          <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]" role="status">
            This house is now on your record. Everything your builder filmed is yours to read, and from now on nobody else sees it without your say.
          </p>
        )}

        <HouseCard
          eyebrow="Your house"
          address={addressLine(property)}
          place={placeLine(property)}
          standing={standingLine(stats)}
          ticks={ticks}
          tickHref={(stage) => `${base}/stages/${stage}`}
        />

        {pending.length > 0 && (
          <Link href={`${base}/access`} className="card flex min-h-[3.25rem] items-center gap-3 px-4 py-3" style={{ borderColor: "var(--accent)" }}>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-medium leading-snug">
                {orgNames.get(pending[0].requesterOrgId)?.name ?? "An organisation"} is asking to see this house
                {pending.length > 1 ? ` (and ${pending.length - 1} more)` : ""}
              </span>
              <span className="mt-0.5 block text-[0.75rem] text-[var(--ink-2)]">Decide on the Access page</span>
            </span>
            <span className="chip chip-accent shrink-0">{plural(pending.length, "request")}</span>
          </Link>
        )}

        {latest && latestDef ? (
          <GradeStamp
            score={latest.score}
            grade={latest.grade}
            stageLabel={`${latestDef.label} · latest`}
            caption={gradeReading(latestDef.label, latest.grade, latest.score, { passed: latest.checkpointsPassed, assessed: latest.checkpointsAssessed })}
            tally={latest.checkpointsAssessed > 0 ? `${latest.checkpointsPassed} of ${latest.checkpointsAssessed} points passed` : undefined}
          />
        ) : (
          <section className="card px-4 py-4">
            <h2 className="eyebrow">No grade yet</h2>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Your builder has not filmed a stage on this house yet. The first grade appears here the moment one is on file.
            </p>
          </section>
        )}

        <section className="card overflow-hidden">
          <dl className="rule-grid grid-cols-3 border-t-0">
            <div className="field">
              <dt>Points passed</dt>
              <dd>{stats.pointsAssessed > 0 ? `${stats.pointsPassed} / ${stats.pointsAssessed}` : "—"}</dd>
            </div>
            <div className="field">
              <dt>Open safety</dt>
              <dd style={stats.openSafetyItems > 0 ? { color: "var(--grade-d)" } : undefined}>{stats.openSafetyItems}</dd>
            </div>
            <div className="field">
              <dt>Materials</dt>
              <dd>{stats.materialsLines > 0 ? formatMoneyCents(stats.materialsTotalCents) : "—"}</dd>
            </div>
          </dl>
          <p className="border-t border-[var(--line)] px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {stats.pointsAssessed > 0
              ? `Of the ${stats.pointsAssessed} ledger points the record could assess so far, ${stats.pointsPassed} passed. `
              : "No ledger points have been assessed yet. "}
            {stats.openSafetyItems > 0
              ? `${plural(stats.openSafetyItems, "safety point is", "safety points are")} still failing or flagged — those are the ones to ask your builder about first. `
              : "No safety point is failing or flagged. "}
            {stats.materialsLines > 0
              ? `${plural(stats.materialsLines, "material line is", "material lines are")} on record, ${formatMoneyCents(stats.materialsTotalCents)} at list prices.`
              : "No materials are on record yet."}
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="eyebrow">Your house</h2>
          </div>
          <ul className="card mt-2.5 overflow-hidden">
            <NavRow href={`${base}/materials`} title="What is in your walls" sub={stats.materialsLines > 0 ? `${plural(stats.materialsLines, "line")} · ${formatMoneyCents(stats.materialsTotalCents)}` : "Nothing on record yet"} />
            <NavRow href={`${base}/access`} title="Who may see this record" sub={pending.length > 0 ? `${plural(pending.length, "request")} waiting on you` : "Grants, share links, and every look taken"} />
            <NavRow href={`${base}/documents`} title="Documents" sub="Permits, warranties, manuals, plans" />
            <NavRow href={`${base}/history`} title="History" sub="The full timeline and who owned it when" />
          </ul>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Recently</h2>
            <Link href={`${base}/history`} className="tnum text-[0.625rem] uppercase tracking-[0.14em] text-[var(--accent)]">
              Show everything
            </Link>
          </div>
          <Timeline events={events} stageHref={(stage) => `${base}/stages/${stage}`} />
        </section>

        <section>
          <h2 className="eyebrow">The sequence</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Eleven stages, in the order a house goes together. Tap one to see its model, its ledger, and what was put in.
          </p>
          <div className="mt-3">
            <StageRail ticks={ticks} href={(stage) => `${base}/stages/${stage}`} />
          </div>
        </section>
      </main>
    </>
  );
}

function NavRow({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <li className="border-b border-[var(--line)] last:border-b-0">
      <Link href={href} className="flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-medium leading-snug">{title}</span>
          <span className="tnum mt-0.5 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">{sub}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
          <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}
