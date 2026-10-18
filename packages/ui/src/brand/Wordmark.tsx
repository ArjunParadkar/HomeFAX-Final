/**
 * The HOMEFAX wordmark. HOME inherits the surrounding color, FAX takes the
 * accent — claude on dark surfaces, burnt on light, which is exactly what
 * var(--accent) resolves to per theme. Tracking is generous per the brand
 * kit; the padding-left offsets the trailing letter-space so it centers true.
 */
export default function Wordmark({
  size = 26,
  tracking = 0.16,
  accent,
  className = "",
}: {
  size?: number | string;
  /** em units of letter-spacing; the kit uses 0.34 on the splash, 0.16 in lockups. */
  tracking?: number;
  /** Override the FAX color (e.g. "var(--claude)" on a hand-built onyx panel). */
  accent?: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        fontWeight: 700,
        fontSize: size,
        letterSpacing: `${tracking}em`,
        paddingLeft: `${tracking}em`,
        whiteSpace: "nowrap",
      }}
    >
      HOME
      <span style={{ color: accent ?? "var(--accent)" }}>FAX</span>
    </span>
  );
}
