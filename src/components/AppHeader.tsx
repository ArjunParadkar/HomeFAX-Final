import Link from "next/link";

export default function AppHeader({
  back,
  title,
  subtitle,
}: {
  back?: { href: string; label: string };
  title?: string;
  subtitle?: string;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]/92 backdrop-blur-md">
      <div className="shell flex items-center gap-3 py-3">
        {back ? (
          <Link
            href={back.href}
            className="-ml-1 flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[var(--ink-2)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M10 3.5 5.5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {back.label}
          </Link>
        ) : (
          <Link href="/records" className="text-lg font-bold tracking-tight">
            HOME<span className="text-[var(--accent)]">FAX</span>
          </Link>
        )}
      </div>
      {title && (
        <div className="shell pb-3">
          <h1 className="text-[1.375rem] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[0.8125rem] text-[var(--ink-2)]">{subtitle}</p>}
        </div>
      )}
    </header>
  );
}
