import Link from "next/link";
import { Wordmark } from "@homefax/ui";
import { setActiveOrgAction, signOutAction } from "@/app/account/actions";
import RailNav from "@/components/RailNav";
import { railSections } from "@/lib/nav";
import { KIND_LABEL, type Workspace } from "@/lib/workspace";

/**
 * The left edge of the ledger room: the mark, which institution you are acting
 * for, the sections, and the person. Fixed on a desk; stacks on a phone.
 */
export default function Rail({ ws }: { ws: Workspace }) {
  const others = ws.all.filter((o) => o.id !== ws.org.id);
  return (
    <aside className="rail-side">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <Link href="/dashboard" aria-label="HomeFAX dashboard" className="flex min-h-[2.25rem] items-center">
          <Wordmark size={17} tracking={0.16} />
        </Link>
        <span className="eyebrow">Institutions</span>
      </div>

      <details className="group border-b border-[var(--line)]">
        <summary className="flex items-center gap-3 px-5 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="label block">{KIND_LABEL[ws.org.kind]}</span>
            <span className="block truncate text-[0.9375rem] font-semibold leading-snug">{ws.org.name}</span>
          </span>
          <svg className="shrink-0 transition-transform duration-150 group-open:rotate-90" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="space-y-1 px-3 pb-3">
          {others.length > 0 && (
            <ul className="space-y-0.5">
              {others.map((o) => (
                <li key={o.id}>
                  <form action={setActiveOrgAction}>
                    <input type="hidden" name="orgId" value={o.id} />
                    <button type="submit" className="rail-link w-full text-left">
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      <span className="chip">{KIND_LABEL[o.kind]}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <Link href="/onboard" className="rail-link text-[0.8125rem]">
            Register another institution
          </Link>
        </div>
      </details>

      <RailNav sections={railSections(ws.org.kind)} />

      <div className="mt-auto border-t border-[var(--line)] px-3 py-3">
        <Link href="/account" className="rail-link min-h-[2.75rem]">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.875rem] font-medium leading-snug text-[var(--ink)]">{ws.me.profile.name}</span>
            <span className="block truncate text-[0.6875rem] text-[var(--ink-3)]">{ws.me.identity.email}</span>
          </span>
        </Link>
        <form action={signOutAction} className="mt-0.5">
          <button type="submit" className="rail-link w-full text-left text-[0.8125rem]">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
