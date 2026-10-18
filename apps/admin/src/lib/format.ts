import type { AddressParts } from "@homefax/db";

/** Figures in the ledger room: mono, tabular, and never ambiguous about their unit. */

export function money(cents: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  if (opts.compact && Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (opts.compact && Math.abs(dollars) >= 10_000) return `$${Math.round(dollars / 1000)}k`;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function pct(bps: number | null | undefined): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

export function date(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00` : v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function daysUntil(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(`${v}T00:00:00`) : v;
  return Math.ceil((d.getTime() - Date.now()) / 86400_000);
}

export function streetOf(p: Pick<AddressParts, "line1" | "line2">): string {
  return p.line2 ? `${p.line1}, ${p.line2}` : p.line1;
}

export function cityOf(p: Pick<AddressParts, "city" | "state" | "postalCode">): string {
  return `${p.city}, ${p.state} ${p.postalCode}`;
}

export function n(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("en-US");
}

export function score(v: number | null | undefined): string {
  return v == null ? "—" : String(Math.round(v));
}

/** Last four of a decrypted reference, or the mask when it could not be read. */
export function masked(ref: string | null): string {
  if (!ref) return "—";
  if (ref === "••••") return ref;
  return `••••${ref.slice(-4)}`;
}

export function titleWord(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
