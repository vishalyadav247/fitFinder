// Analytics page wording and numbers (specs/analytics.md). Pure, so the page and tests share it.

/** Periods the page offers, in days. */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 30;
/** Counts are kept this long: the longest period plus the one before it, for the comparison. */
export const KEEP_DAYS = 180;
export const TOP = 10;

export const toPeriod = (text: string | null): Period =>
  PERIODS.find((p) => String(p) === text) ?? DEFAULT_PERIOD;

export const fmt = (n: number) => n.toLocaleString("en-US");

/** Whole percent of `part` in `whole`; null when there's nothing to divide. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** "+12% vs the previous 30 days", or why there's no comparison. */
export function changeLine(now: number, before: number, days: number): string {
  const period = `the previous ${days} days`;
  if (before === 0) {
    return now === 0 ? `None in ${period} either` : `None in ${period}`;
  }
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return `Same as ${period}`;
  return `${change > 0 ? "+" : ""}${change}% vs ${period}`;
}

/**
 * A selection as the merchant reads it: the picked values in search field order,
 * e.g. "Oily › Sensitive" or "Apple › iPhone 15". Values of fields removed since are left out; null when none is left.
 */
export function selectionText(
  fields: { id: string }[],
  picks: Record<string, string>,
): string | null {
  const parts = fields.filter((f) => picks[f.id]).map((f) => picks[f.id]);
  return parts.length ? parts.join(" › ") : null;
}

/** "Oct 3": a YYYY-MM-DD day for the chart and tables (the days are UTC). */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
