/**
 * Addresses, split into their parts. The database dedups on a key made from
 * these parts, so the same house typed two ways lands on one row.
 */
export type AddressParts = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  county?: string | null;
  country?: string;
};

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" "),
);

export function isUsState(s: string): boolean {
  return STATES.has(s.toUpperCase());
}

/** Title Case for street and city names, keeping ordinals and numbers alone. */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/^\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .trim();
}

export function normalizeAddress(p: AddressParts): Required<Omit<AddressParts, "line2" | "county">> & { line2: string | null; county: string | null } {
  const state = p.state.trim().toUpperCase();
  if (!isUsState(state)) throw new Error(`"${p.state}" is not a two-letter US state`);
  const postal = p.postalCode.trim().replace(/[^0-9-]/g, "").slice(0, 10);
  if (!/^\d{5}(-\d{4})?$/.test(postal)) throw new Error("ZIP code must be 5 digits (optionally ZIP+4)");
  return {
    line1: titleCase(p.line1.replace(/\s+/g, " ")),
    line2: p.line2?.trim() ? titleCase(p.line2) : null,
    city: titleCase(p.city.replace(/\s+/g, " ")),
    state,
    postalCode: postal,
    county: p.county?.trim() ? titleCase(p.county) : null,
    country: (p.country ?? "US").toUpperCase(),
  };
}

/** The same key the database generates — so we can look a property up before inserting. */
export function addressKey(p: AddressParts): string {
  return (p.line1 + (p.line2 ?? "") + p.city + p.state + p.postalCode).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/**
 * Best-effort split of a one-line address:
 *   "1418 Ridgemont Dr, Bentonville, AR 72712"
 *   "1418 Ridgemont Dr Apt 4, Bentonville AR 72712-1234"
 * Returns null when the state or ZIP cannot be found — the form should then ask for parts.
 */
export function parseAddressLine(text: string): AddressParts | null {
  const m = text.trim().match(/^(.*?),\s*([^,]+?)[,\s]+([A-Za-z]{2})[,\s]+(\d{5}(?:-\d{4})?)\s*$/);
  if (!m) return null;
  const [, street, city, state, postalCode] = m;
  if (!isUsState(state)) return null;
  let line1 = street.trim();
  let line2: string | null = null;
  const unit = line1.match(/^(.*?)[,\s]+((?:apt|apartment|unit|suite|ste|#|bldg|rm|room|lot)\.?\s*[\w-]+)$/i);
  if (unit) {
    line1 = unit[1].trim();
    line2 = unit[2].trim();
  }
  return { line1, line2, city: city.trim(), state: state.toUpperCase(), postalCode };
}

export function formatAddress(p: AddressParts, opts: { oneLine?: boolean } = {}): string {
  const street = p.line2 ? `${p.line1}, ${p.line2}` : p.line1;
  return opts.oneLine === false ? `${street}\n${p.city}, ${p.state} ${p.postalCode}` : `${street}, ${p.city}, ${p.state} ${p.postalCode}`;
}
