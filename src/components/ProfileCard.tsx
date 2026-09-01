import { hireAction } from "@/app/account/actions";

/**
 * A listing on the hire board, set like the contractor's card stapled inside
 * the permit box: the name, the mono id it answers to, one line of what they
 * do. The offer itself is folded away behind a summary so the board stays
 * readable at arm's length — open it and you are writing the task, not
 * browsing.
 */
export default function ProfileCard({
  kind,
  to,
  name,
  handle,
  headline,
  bio,
  records,
  canHire,
}: {
  kind: "person" | "company";
  /** The addressee token the action expects: "u:<userId>" or "o:<orgId>". */
  to: string;
  name: string;
  /** "@handle" for a person, the slug for a company. */
  handle: string;
  headline: string | null;
  bio: string | null;
  /** Properties the offer can be tied to — the active company's records. */
  records: { id: string; address: string }[];
  /** False when the reader has no company to send from. */
  canHire: boolean;
}) {
  const id = to.replace(":", "-");

  return (
    <li className="card overflow-hidden">
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[1rem] font-semibold leading-snug">{name}</h3>
            <p className="tnum mt-1 truncate text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
              {handle}
            </p>
          </div>
          <span className="chip shrink-0">{kind === "person" ? "Person" : "Company"}</span>
        </div>

        {headline && (
          <p className="mt-2 text-[0.875rem] leading-snug text-[var(--ink-2)]">{headline}</p>
        )}
        {bio && (
          <p className="mt-1 line-clamp-1 text-[0.8125rem] leading-relaxed text-[var(--ink-3)]">
            {bio}
          </p>
        )}
      </div>

      {canHire ? (
        <details className="group border-t border-[var(--line)]">
          <summary className="flex min-h-[2.75rem] items-center gap-2 px-4 py-2">
            <span className="eyebrow">Send an offer</span>
            <svg
              className="ml-auto shrink-0 transition-transform duration-150 group-open:rotate-90"
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

          <form action={hireAction} className="space-y-3.5 border-t border-[var(--line)] px-4 py-4">
            <input type="hidden" name="to" value={to} />
            <div>
              <label className="label block" htmlFor={`task-${id}`}>
                The work
              </label>
              <input
                id={`task-${id}`}
                name="task"
                required
                placeholder="Frame the second floor"
                className="input mt-1.5"
              />
            </div>
            <div>
              <label className="label block" htmlFor={`note-${id}`}>
                Note <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input
                id={`note-${id}`}
                name="note"
                placeholder="Dates, scope, rate"
                className="input mt-1.5"
              />
            </div>
            {records.length > 0 && (
              <div>
                <label className="label block" htmlFor={`record-${id}`}>
                  Property <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <select id={`record-${id}`} name="recordId" defaultValue="" className="input mt-1.5">
                  <option value="">No property yet</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.address}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="submit" className="btn btn-primary w-full">
              Send offer
            </button>
          </form>
        </details>
      ) : (
        <p className="border-t border-[var(--line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
          Offers are sent from a company. Register yours on Team to hire {name}.
        </p>
      )}
    </li>
  );
}
