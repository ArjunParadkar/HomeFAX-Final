import type { ReactNode } from "react";

/** The page's identity: a mono eyebrow saying what kind of thing this is, the name, and the actions at the right edge. */
export default function PageTitle({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="title-row">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1.5 text-[1.5rem] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[60ch] text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
