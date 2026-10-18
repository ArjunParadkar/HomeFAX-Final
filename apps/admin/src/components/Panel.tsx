import type { ReactNode } from "react";

/** A paper card with a ruled header. The body is whatever the section needs: a table, a form, a list. */
export default function Panel({
  title,
  meta,
  children,
  className = "",
  flush = false,
}: {
  title: ReactNode;
  /** Right-hand mono figure or control. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No padding around the body — for tables and lists that rule themselves. */
  flush?: boolean;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <h2 className="eyebrow">{title}</h2>
        {meta && <div className="tnum shrink-0 text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">{meta}</div>}
      </header>
      <div className={flush ? "" : "px-4 py-4"}>{children}</div>
    </section>
  );
}

/** A quiet empty state that points to the next action. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{children}</p>;
}
