"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RailSection } from "@/lib/nav";

/** The rail's links. Client only so the current section can carry aria-current. */
export default function RailNav({ sections }: { sections: RailSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="rail-nav flex flex-col gap-4 px-3 py-4">
      {sections.map((s) => (
        <div key={s.title} className="contents lg:block">
          <p className="rail-section-title eyebrow mb-1.5 px-3">{s.title}</p>
          <ul className="contents lg:block lg:space-y-0.5">
            {s.items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
              return (
                <li key={it.href}>
                  <Link href={it.href} className="rail-link" aria-current={active ? "page" : undefined}>
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
