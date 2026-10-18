/**
 * A freshly minted share URL is shown exactly once. It travels from the action
 * to the access page in a short-lived httpOnly cookie scoped to that page —
 * never in a query string, where it would sit in the browser history.
 */
export const SHARE_LINK_COOKIE = "hfx_owner_share_link";

export type ShownShareLink = { url: string; linkId: string; label: string | null };

export function parseShownShareLink(raw: string | undefined): ShownShareLink | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ShownShareLink>;
    return v && typeof v.url === "string" && typeof v.linkId === "string" ? { url: v.url, linkId: v.linkId, label: v.label ?? null } : null;
  } catch {
    return null;
  }
}
