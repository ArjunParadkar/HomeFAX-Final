import type { Property } from "@homefax/db";

/**
 * How a house is named on screen. The street line is the title everywhere —
 * it is what the crew calls the job — and the city line sits under it in mono.
 */
export function streetOf(p: Pick<Property, "line1" | "line2">): string {
  return p.line2 ? `${p.line1}, ${p.line2}` : p.line1;
}

export function cityLineOf(p: Pick<Property, "city" | "state" | "postalCode">): string {
  return `${p.city}, ${p.state} ${p.postalCode}`;
}

export function formatDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return new Date(d).toLocaleDateString("en-US", opts);
}
