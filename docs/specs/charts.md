# Charts in the admin app

Charts are read by people and executed by code; the rules below make them right
by construction. They follow the dataviz method: form first, colour last.

- **Pick the form by the data's job.** Magnitude across categories → horizontal
  bars. Share of a fixed set (grade distribution A–F, stage completion 1–11) →
  a single stacked bar or small bars, never a pie. One headline number → a stat
  tile (`.field`), not a chart. Change over time with < 6 points → a table.
- **One axis.** Never two y-scales. Two measures → two small charts.
- **Colour follows meaning.** Grades use the grade tokens (`--grade-a`…`--grade-f`)
  and *always* print the letter. Status (verified / flagged / pending) uses
  grade-a / grade-f / ink-3 with a word beside it. Everything else is `--ink`
  at reduced opacity; the app accent is reserved for the current selection.
- **Marks:** 2px lines, bars with 2px gaps and a 4px radius on the data end,
  recessive axes in `--line`, labels in mono (`.tnum`), direct labels on the
  bar end instead of a legend when ≤ 4 series.
- **Every chart has a table.** Render the same numbers as a `<table>` under a
  `<details>` ("Show the numbers") so the chart is never the only carrier.
- **Hover:** a title attribute or a visible value on the bar is enough; no
  tooltip library.
- Pure inline SVG or CSS grid bars in server components. No chart library.
