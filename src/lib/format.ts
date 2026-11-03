import type { EventDatePrecision } from "@/lib/enums";

/**
 * Display formatting for the public pages.
 *
 * The one rule worth stating: a date is never rendered more precisely than it
 * was recorded. `event_date_precision = 'year'` is stored as `2025-01-01`
 * because the column is a `date`, and printing that as «2025 年 1 月 1 日»
 * would invent a day the sources never gave (dictionary §3). Both formatters
 * below read the precision and truncate accordingly.
 */

function parts(iso: string): { year: string; month: string; day: string } {
  const [year = "", month = "", day = ""] = iso.split("-");
  return { year, month, day };
}

function asPrecision(value: string): EventDatePrecision {
  return value === "year" || value === "month" ? value : "day";
}

/** «2025 年 10 月 27 日» / «2025 年 10 月» / «2025 年». */
export function formatEventDate(iso: string, precision: string): string {
  const { year, month, day } = parts(iso);
  switch (asPrecision(precision)) {
    case "year":
      return `${year} 年`;
    case "month":
      return `${year} 年 ${Number(month)} 月`;
    default:
      return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
  }
}

/** `2025-10-27` / `2025-10` / `2025` — for the dense mono meta lines. */
export function formatEventDateCompact(iso: string, precision: string): string {
  const { year, month, day } = parts(iso);
  switch (asPrecision(precision)) {
    case "year":
      return year;
    case "month":
      return `${year}-${month}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

/** Source publication dates are always exact, so they need no precision rule. */
export function formatSourceDate(iso: string): string {
  const { year, month, day } = parts(iso);
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

/** One decimal, trailing `.0` dropped: `40%`, `6.7%`. */
export function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (value / total) * 100;
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

/** `45` → `45%`; the column is `numeric`, so it arrives as a string. */
export function formatAffectedPct(raw: string | null): string | null {
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return `${String(value)}%`;
}

/** `www.cnbc.com` — shown next to a source link so the target is visible. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
