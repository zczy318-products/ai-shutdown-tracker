import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The whole chart layer: two bar shapes, server-rendered, no chart library.
 *
 * Design spec §5 left the choice open and leaned this way, which is the call
 * taken here. All four dashboard charts are counts of a categorical axis, so a
 * bar is a `<div>` with a percentage width — that is zero dependencies, zero
 * client JavaScript, nothing added to the bundle on a Vercel Hobby plan, and it
 * renders inside the server component instead of needing `ssr: false`. A chart
 * library would have bought interactions these four charts do not have.
 *
 * Both shapes obey the spec's hard rules: counts start at 0, a single series
 * gets no legend, colour comes only from the `--chart-*` / `--conf-*` tokens
 * (never a literal), every bar carries a visible value label, and the hover
 * target is the whole row rather than the bar itself.
 */

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** A `bg-*` token class. Defaults to slot 1 — the single-series colour. */
  colorClass?: string;
  /** Appended to the row's tooltip. */
  hint?: string;
};

/**
 * Horizontal bars, used wherever the category labels are words: industry,
 * region, impact type, confidence. Bar length is relative to the largest row,
 * so the comparison is between rows; the number next to it is the value, so no
 * axis is needed.
 */
export function HorizontalBars({
  data,
  total,
  withPercent = false,
  labelWidth = "11rem",
}: {
  data: BarDatum[];
  /** Denominator for the percentage column. Defaults to the sum of `data`. */
  total?: number;
  withPercent?: boolean;
  labelWidth?: string;
}) {
  const sum = total ?? data.reduce((acc, row) => acc + row.value, 0);
  const max = Math.max(1, ...data.map((row) => row.value));

  return (
    <ul className="space-y-1">
      {data.map((row) => (
        <li
          key={row.key}
          data-bar-key={row.key}
          data-bar-value={row.value}
          className="hover:bg-muted/60 grid items-center gap-3 rounded-md px-1.5 py-1 transition-colors"
          style={{ gridTemplateColumns: `minmax(0, ${labelWidth}) 1fr` }}
          title={`${row.label}：${row.value} 条${withPercent ? `（${formatPercent(row.value, sum)}）` : ""}${row.hint ? ` · ${row.hint}` : ""}`}
        >
          <span className="truncate text-xs">{row.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3.5 min-w-0 flex-1">
              <span
                className={cn("block h-3.5 rounded-sm", row.colorClass ?? "bg-chart-1")}
                // Percentage of the widest row. A non-zero count never renders
                // as an invisible sliver, but zero stays zero.
                style={{ width: row.value === 0 ? 0 : `${Math.max((row.value / max) * 100, 2)}%` }}
                aria-hidden
              />
            </span>
            <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
              {row.value} 条{withPercent ? ` · ${formatPercent(row.value, sum)}` : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Vertical columns for the yearly trend. Deliberately not a line chart: events
 * are a discrete count per year over a few dozen records, and a line would draw
 * a continuity between years that the data does not contain (spec §4.1).
 */
export function YearColumns({ data }: { data: { key: number; count: number }[] }) {
  const max = Math.max(1, ...data.map((row) => row.count));

  return (
    <div>
      <div className="relative h-44">
        {/* Hairline gridlines, pushed into the background. */}
        {[0, 25, 50, 75].map((offset) => (
          <span
            key={offset}
            className="bg-chart-grid absolute inset-x-0 h-px"
            style={{ top: `${offset}%` }}
            aria-hidden
          />
        ))}
        <ol className="border-chart-axis relative flex h-full items-end gap-1.5 border-b">
          {data.map((row) => (
            <li
              key={row.key}
              data-bar-key={row.key}
              data-bar-value={row.count}
              className="hover:bg-muted/50 flex h-full flex-1 cursor-default flex-col justify-end gap-1 rounded-t-md pt-1 transition-colors"
              title={`${row.key} 年：${row.count} 条`}
            >
              <span className="text-muted-foreground text-center font-mono text-[11px] tabular-nums">
                {row.count}
              </span>
              <span
                className="bg-chart-1 w-full rounded-t-[4px]"
                // `max` is the tallest column, so the axis starts at 0 and the
                // tallest bar fills the plot area.
                style={{ height: row.count === 0 ? 1 : `${(row.count / max) * 100}%` }}
                aria-hidden
              />
            </li>
          ))}
        </ol>
      </div>
      <ol className="mt-1 flex gap-1.5">
        {data.map((row) => (
          <li
            key={row.key}
            className="text-muted-foreground flex-1 text-center font-mono text-[11px] tabular-nums"
          >
            {row.key}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Shared frame: a title, the counting rule under it, and the chart. */
export function ChartCard({
  title,
  note,
  legend,
  children,
}: {
  title: string;
  note: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card space-y-3 rounded-xl border p-5">
      <div className="space-y-1">
        {/*
          h2, not h3: these cards sit directly under the dashboard's h1, and
          the «统计口径» section after them is already an h2. As h3 the page
          jumped h1 → h3, which is the kind of gap that makes a screen
          reader's heading list misrepresent the structure. The visual size
          is set by the classes, so the level costs nothing to get right.
        */}
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground text-xs">{note}</p>
      </div>
      {legend}
      {children}
    </section>
  );
}

/**
 * The table view of the same numbers (spec §4.5). Not an optional extra: it is
 * the accessible reading of every chart, and the stated precondition for the
 * two slot colours that sit just under 3:1 against the light background.
 */
export function StatTable({
  caption,
  dimension,
  rows,
  total,
}: {
  caption: string;
  dimension: string;
  rows: { key: string; label: string; value: number }[];
  total?: number;
}) {
  const sum = total ?? rows.reduce((acc, row) => acc + row.value, 0);

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="text-muted-foreground mb-2 text-left text-xs">{caption}</caption>
      <thead>
        <tr className="border-b text-left">
          <th scope="col" className="py-1.5 pr-4 font-medium">
            {dimension}
          </th>
          <th scope="col" className="w-24 py-1.5 text-right font-medium">
            记录数
          </th>
          <th scope="col" className="w-24 py-1.5 text-right font-medium">
            占比
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            data-row-key={row.key}
            data-row-value={row.value}
            className="border-b last:border-0"
          >
            <th scope="row" className="py-1.5 pr-4 text-left font-normal">
              {row.label}
            </th>
            <td className="py-1.5 text-right font-mono tabular-nums">{row.value}</td>
            <td className="text-muted-foreground py-1.5 text-right font-mono tabular-nums">
              {formatPercent(row.value, sum)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
