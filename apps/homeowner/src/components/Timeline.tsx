import Link from "next/link";
import { stageDef } from "@homefax/core";
import type { PropertyEvent } from "@homefax/db";
import { isStageId } from "@homefax/core";
import { formatDay } from "@/lib/format";

/**
 * The house's story, newest first. Each entry is one line of what happened and,
 * where it was about a stage, a link straight to that stage's page.
 */

const KIND_WORD: Partial<Record<PropertyEvent["kind"], string>> = {
  record_opened: "Record",
  stage_filmed: "Filmed",
  stage_graded: "Graded",
  stage_failed: "Failed",
  owner_claimed: "Owner",
  owner_transferred: "Owner",
  access_granted: "Access",
  access_revoked: "Access",
  access_requested: "Request",
  share_link_created: "Share",
  document_added: "Document",
  permit_issued: "Permit",
  inspection_verdict: "City",
  draw_decided: "Lender",
  policy_bound: "Insurer",
  listing_changed: "Listing",
  note: "Note",
};

export default function Timeline({
  events,
  stageHref,
  emptyText = "Nothing has happened on this record yet.",
}: {
  events: PropertyEvent[];
  stageHref?: (stage: string) => string;
  emptyText?: string;
}) {
  if (events.length === 0) {
    return <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{emptyText}</p>;
  }
  return (
    <ol>
      {events.map((e) => {
        const stage = e.stage && isStageId(e.stage) ? stageDef(e.stage) : null;
        return (
          <li key={e.id} className="flex gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
            <span className="tnum w-[3.75rem] shrink-0 pt-0.5 text-[0.625rem] uppercase tracking-[0.1em] text-[var(--ink-3)]">
              {formatDay(e.at)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.875rem] font-medium leading-snug">{e.title}</span>
              {e.detail && (
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{e.detail}</span>
              )}
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="chip">{KIND_WORD[e.kind] ?? e.kind}</span>
                {stage &&
                  (stageHref ? (
                    <Link href={stageHref(stage.id)} className="chip chip-accent min-h-[1.75rem]">
                      {stage.short}
                    </Link>
                  ) : (
                    <span className="chip">{stage.short}</span>
                  ))}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
