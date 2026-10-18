import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorLine, GradeStamp } from "@homefax/ui";
import { stageDef } from "@homefax/core";
import { oversight, records } from "@homefax/db";
import { decideDrawAction } from "@/app/(workspace)/portfolio/actions";
import { DRAW_TONE, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel from "@/components/Panel";
import { cityOf, date, dateTime, masked, money, streetOf, titleWord } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** One draw: the live recommendation with its reasons, the basis capture's grade stamp, and the decision. */
export default async function DrawPage({ params, searchParams }: PageProps<"/draws/[id]">) {
  await requireKind("lender");
  const { id } = await params;
  const sp = await searchParams;

  const data = await asWorkspace(async (tx, ws) => {
    const all = await oversight.listDrawsForOrg(tx, ws.org.id);
    const row = all.find((d) => d.draw.id === id);
    if (!row) return null;
    const live = await oversight.recommendDraw(tx, row.property.id, row.draw.stage);
    const grade = (await records.listStageGrades(tx, row.property.id)).find((g) => g.stage === row.draw.stage) ?? null;
    const names = await records.namesFor(tx, [row.draw.requestedBy, row.draw.decidedBy].filter((x): x is string => Boolean(x)));
    return { row, live, grade, names };
  });
  if (!data) notFound();

  const { row, live, grade } = data;
  const d = row.draw;
  const stage = stageDef(d.stage);

  return (
    <>
      <PageTitle
        eyebrow={`Draw · ${titleWord(d.status)}`}
        title={`${stage.label} · ${money(d.amountCents)}`}
        subtitle={`${streetOf(row.property)}, ${cityOf(row.property)} · ${titleWord(row.holding.kind)} loan ${masked(oversight.dec(row.holding.loanRefEnc))} · requested ${dateTime(d.requestedAt)}${d.requestedBy ? ` by ${data.names.get(d.requestedBy) ?? "the builder"}` : ""}`}
        actions={
          <>
            <StatusWord tone={DRAW_TONE[d.status]}>{titleWord(d.status)}</StatusWord>
            <Link href={`/properties/${row.property.slug}?tab=draws`} className="btn btn-secondary btn-sm">
              Open the record
            </Link>
            <Link href="/draws" className="btn btn-secondary btn-sm">
              All draws
            </Link>
          </>
        }
      />
      <ErrorLine message={sp.error} className="mb-4" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-5">
          {grade ? (
            <GradeStamp
              score={grade.score}
              grade={grade.grade}
              stageLabel={stage.label}
              tally={`${grade.checkpointsPassed} of ${grade.checkpointsAssessed} assessed points passed`}
              caption={`The basis capture, filmed ${date(grade.filmedAt)}. ${grade.simulated ? "Its geometry is a simulated stand-in — the funding floor treats that as a hold." : "Measured geometry" + (grade.visionStatus === "graded" ? " and a visual review." : " only; the visual review did not run.")}`}
            />
          ) : (
            <div className="card px-4 py-5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">No graded capture of {stage.label.toLowerCase()} is on file. The record cannot recommend a release until the stage is filmed and graded.</div>
          )}
          {d.decidedAt && (
            <Panel title="Decision" meta={dateTime(d.decidedAt)}>
              <p className="text-[0.9375rem] font-medium">
                <StatusWord tone={DRAW_TONE[d.status]}>{titleWord(d.status)}</StatusWord>
                {d.decidedBy && <span className="ml-2 text-[0.8125rem] font-normal text-[var(--ink-2)]">by {data.names.get(d.decidedBy) ?? "a member"}</span>}
              </p>
              {d.decisionNote && <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">“{d.decisionNote}”</p>}
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel title="What the record says now" meta={<StatusWord tone={live.recommendation === "release" ? "good" : "warn"}>{titleWord(live.recommendation)}</StatusWord>}>
            <ul className="list-disc space-y-1 pl-5 text-[0.875rem] leading-relaxed text-[var(--ink-2)]">
              {live.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {d.recommendation && (
              <details className="mt-4">
                <summary className="label cursor-pointer">At request time</summary>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-3)]">{d.recommendation}</p>
              </details>
            )}
            <p className="mt-4 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">The recommendation is the record&apos;s, not a decision. Release requires a graded stage at or above the 70-point floor with no unresolved critical finding or failed safety point.</p>
          </Panel>

          {d.status === "requested" ? (
            <Panel title="Decide">
              <form action={decideDrawAction} className="space-y-3">
                <input type="hidden" name="drawId" value={d.id} />
                <input type="hidden" name="back" value={`/draws/${d.id}`} />
                <div>
                  <label className="label block" htmlFor="note">
                    Note <span className="normal-case tracking-normal">(optional, goes on the house&apos;s timeline)</span>
                  </label>
                  <textarea id="note" name="note" rows={2} className="input input-sm mt-1.5" placeholder="Why, in a line" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="status" value="released" className="btn btn-primary btn-sm">
                    Release {money(d.amountCents)}
                  </button>
                  <button type="submit" name="status" value="held" className="btn btn-secondary btn-sm">
                    Hold
                  </button>
                  <button type="submit" name="status" value="rejected" className="btn btn-secondary btn-sm">
                    Reject
                  </button>
                </div>
              </form>
            </Panel>
          ) : (
            d.status === "held" && (
              <Panel title="Revisit">
                <form action={decideDrawAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="drawId" value={d.id} />
                  <input type="hidden" name="back" value={`/draws/${d.id}`} />
                  <div className="min-w-[14rem] flex-1">
                    <label className="label block" htmlFor="note">
                      Note
                    </label>
                    <input id="note" name="note" className="input input-sm mt-1.5" />
                  </div>
                  <button type="submit" name="status" value="released" className="btn btn-primary btn-sm">
                    Release now
                  </button>
                  <button type="submit" name="status" value="rejected" className="btn btn-secondary btn-sm">
                    Reject
                  </button>
                </form>
              </Panel>
            )
          )}
        </div>
      </div>
    </>
  );
}
