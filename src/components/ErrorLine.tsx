/**
 * One line of failure, in the record's voice. Every page reads its ?error=
 * back into this: what went wrong, never an apology, always in the same place
 * — directly under the heading of the panel that failed.
 */
export default function ErrorLine({
  message,
  className = "",
}: {
  /** Straight from searchParams, so a repeated key is handled here not there. */
  message?: string | string[];
  className?: string;
}) {
  const text = Array.isArray(message) ? message[0] : message;
  if (!text) return null;
  return (
    <p
      role="alert"
      className={`text-[0.8125rem] leading-relaxed ${className}`}
      style={{ color: "var(--grade-f)" }}
    >
      {text}
    </p>
  );
}
