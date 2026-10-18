import Link from "next/link";
import { ErrorLine, GradeChip } from "@homefax/ui";
import { stageDef } from "@homefax/core";
import { orgs, oversight } from "@homefax/db";
import { StatusWord, VERDICT_TONE, VERDICT_WORD } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { date, dateTime, plural, score, streetOf } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** The inspection queue, with reviewed stages folded in on request, and the history of verdicts. */
export default async function InspectionsPage({ searchParams }: PageProps<"/inspections">) {
  await requireKind("municipality");
  const sp = await searchParams;
  const includeReviewed = sp.all === "1";
  const data = await asWorkspace(async (tx, ws) => {
    const rows = await oversight.listInspectionQueue(tx, ws.org.id, { includeReviewed: true });
    const names = await orgs.getProfilesByIds(tx, rows.map((r) => r.review?.reviewerId).filter((x): x is string => Boolean(x)));
    return { rows, names };
  });
  const queue = data.rows.filter((r) => !r.review);
  const history = data.rows.filter((r) => r.review).sort((a, b) => b.review!.at.getTime() - a.review!.at.getTime());
  const shown = includeReviewed ? data.rows : queue;
  const ok = Array.isArray(sp.ok) ? sp.ok[0] : sp.ok;

  return (
    <>
      <PageTitle
        eyebrow="Inspections"
        title="Inspection queue"
        subtitle="Every filmed stage inside the jurisdiction. Review one against its model and ledger, then verify it, flag it, or schedule a site visit."
        actions={
          <Link href={includeReviewed ? "/inspections" : "/inspections?all=1"} className="btn btn-secondary btn-sm" aria-pressed={includeReviewed}>
            {includeReviewed ? "Hide reviewed" : "Include reviewed"}
          </Link>
        }
      />
      <ErrorLine message={sp.error} className="mb-4" />
      {ok && ok in VERDICT_WORD && <p className="mb-4 text-[0.8125rem] text-[var(--grade-a)]">Verdict recorded: {VERDICT_WORD[ok as keyof typeof VERDICT_WORD]}. It is on the house&apos;s timeline.</p>}

      <Panel title={includeReviewed ? "Filmed stages" : "Awaiting review"} meta={`${plural(shown.length, "stage")}`} flush className="mb-5">
        {shown.length === 0 ? (
          <Empty>Nothing is waiting. Every filmed stage inside your jurisdiction has a verdict.</Empty>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Address</th>
                  <th>Grade</th>
                  <th className="num">Score</th>
                  <th className="num">Points</th>
                  <th>Filmed</th>
                  <th>Verdict</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => (
                  <tr key={q.capture.id}>
                    <td className="font-medium">{stageDef(q.capture.stage).label}</td>
                    <td>
                      <Link href={`/properties/${q.property.slug}`}>{streetOf(q.property)}</Link>
                    </td>
                    <td>{q.grade ? <GradeChip grade={q.grade.grade} size="sm" /> : "—"}</td>
                    <td className="num">{score(q.grade?.score)}</td>
                    <td className="num">{q.grade ? `${q.grade.checkpointsPassed}/${q.grade.checkpointsAssessed}` : "—"}</td>
                    <td className="mono">{date(q.capture.createdAt)}</td>
                    <td>{q.review ? <StatusWord tone={VERDICT_TONE[q.review.verdict]}>{VERDICT_WORD[q.review.verdict]}</StatusWord> : <span className="text-[var(--ink-3)]">Pending</span>}</td>
                    <td className="num">
                      <Link href={`/inspections/${q.capture.id}`} className={`btn btn-sm ${q.review ? "btn-secondary" : "btn-primary"}`}>
                        {q.review ? "Re-review" : "Review"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="History" meta={plural(history.length, "verdict")} flush>
        {history.length === 0 ? (
          <Empty>No verdicts yet.</Empty>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Stage</th>
                  <th>Address</th>
                  <th>Verdict</th>
                  <th>By</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.review!.id}>
                    <td className="mono whitespace-nowrap">{dateTime(h.review!.at)}</td>
                    <td>{stageDef(h.capture.stage).label}</td>
                    <td>
                      <Link href={`/properties/${h.property.slug}`}>{streetOf(h.property)}</Link>
                    </td>
                    <td>
                      <StatusWord tone={VERDICT_TONE[h.review!.verdict]}>{VERDICT_WORD[h.review!.verdict]}</StatusWord>
                    </td>
                    <td>{h.review!.reviewerId ? data.names.get(h.review!.reviewerId)?.name ?? "—" : "—"}</td>
                    <td className="max-w-[24rem] text-[var(--ink-2)]">{h.review!.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
