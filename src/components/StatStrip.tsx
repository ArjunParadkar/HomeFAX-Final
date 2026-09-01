/**
 * The header block of an inspection card: a row of ruled boxes, field name
 * over figure. Same unit as the record's own spec strip — a count of things on
 * file, never a metric anyone has to interpret.
 */

const COLS: Record<2 | 3, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
};

export default function StatStrip({
  items,
  cols = 2,
  className = "",
}: {
  items: { term: string; value: string }[];
  cols?: 2 | 3;
  className?: string;
}) {
  return (
    <dl className={`rule-grid ${COLS[cols]} ${className}`}>
      {items.map((item) => (
        <div key={item.term} className="field">
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
