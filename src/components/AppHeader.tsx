import Link from "next/link";
import Wordmark from "@/components/brand/Wordmark";

/**
 * The head of every page in the record. Row one is navigation and the mark;
 * row two is the page's own identity — a mono eyebrow saying what kind of thing
 * this is, then its name. The meta slot on the right carries position in a
 * sequence (stage 3 of 11) and nothing else.
 */
export default function AppHeader({
  back,
  eyebrow,
  title,
  subtitle,
  meta,
}: {
  back?: { href: string; label: string };
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  meta?: string;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]/92 backdrop-blur-md">
      <div className="shell flex items-center gap-3 py-2.5">
        {back ? (
          <Link
            href={back.href}
            className="-ml-2 flex min-h-[2.75rem] min-w-0 items-center gap-1 rounded-[10px] px-2 text-[0.875rem] font-medium text-[var(--ink-2)]"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
              className="shrink-0"
            >
              <path
                d="M10 3.5 5.5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="truncate">{back.label}</span>
          </Link>
        ) : (
          <Link
            href="/records"
            className="flex min-h-[2.75rem] items-center"
            aria-label="HomeFAX records"
          >
            <Wordmark size={17} tracking={0.16} />
          </Link>
        )}
        {meta && (
          <span className="tnum ml-auto shrink-0 text-[0.625rem] uppercase tracking-[0.16em] text-[var(--ink-3)]">
            {meta}
          </span>
        )}
      </div>

      {title && (
        <div className="shell pb-3">
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="text-[1.375rem] font-semibold leading-tight">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{subtitle}</p>
          )}
        </div>
      )}
    </header>
  );
}
