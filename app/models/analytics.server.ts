// Analytics page reads (specs/analytics.md): the shop's storefront counts for a period, from the
// daily tables the app proxy fills (services/analytics/record.server.ts). Days are UTC.
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { KEEP_DAYS, TOP, type Period } from "../services/analytics/report";

export {
  KEEP_DAYS,
  PERIODS,
  TOP,
  toPeriod,
} from "../services/analytics/report";

export interface SelectionStat {
  picks: Record<string, string>;
  searches: number;
  noResults: number;
  /** Last day (YYYY-MM-DD) a search for it found nothing; null when it never did. */
  lastNoResult: string | null;
}

export interface AnalyticsReport {
  /** Any count at all, in any period: false shows the "nothing yet" state. */
  hasData: boolean;
  searches: number;
  previousSearches: number;
  noResults: number;
  selections: number;
  fits: number;
  noFit: number;
  previousChecks: number;
  /** One entry per day of the period, oldest first. */
  daily: { day: string; searches: number; noResults: number }[];
  topSelections: SelectionStat[];
  nothingFound: SelectionStat[];
  products: {
    productId: string;
    title: string | null;
    fits: number;
    noFit: number;
  }[];
}

const UTC_TODAY = Prisma.sql`(now() AT TIME ZONE 'UTC')::date`;

const n = (v: number | bigint | null | undefined) => Number(v ?? 0);

export async function analyticsReport(
  shopId: string,
  days: Period,
): Promise<AnalyticsReport> {
  // First day of the period, and of the period before it.
  const from = Prisma.sql`(${UTC_TODAY} - ${days - 1}::int)`;
  const before = Prisma.sql`(${UTC_TODAY} - ${2 * days - 1}::int)`;
  const selection = (where: Prisma.Sql, order: Prisma.Sql) => prisma.$queryRaw<
    {
      picks: Record<string, string>;
      searches: number;
      no_results: number;
      last_no_result: string | null;
    }[]
  >`
    SELECT (array_agg(s.picks ORDER BY s.day DESC))[1] AS picks,
           sum(s.searches)::int AS searches, sum(s.no_results)::int AS no_results,
           to_char(max(s.day) FILTER (WHERE s.no_results > 0), 'YYYY-MM-DD') AS last_no_result
    FROM search_stats s
    WHERE s.shop_id = ${shopId} AND s.day >= ${from}
    GROUP BY s.selection_key
    ${where}
    ORDER BY ${order}, s.selection_key
    LIMIT ${TOP}`;

  const [[totals], [checks], daily, top, nothing, products, [any]] =
    await Promise.all([
      prisma.$queryRaw<
        {
          searches: number;
          previous: number;
          no_results: number;
          selections: number;
        }[]
      >`
        SELECT coalesce(sum(searches) FILTER (WHERE day >= ${from}), 0)::int AS searches,
               coalesce(sum(searches) FILTER (WHERE day < ${from}), 0)::int AS previous,
               coalesce(sum(no_results) FILTER (WHERE day >= ${from}), 0)::int AS no_results,
               count(DISTINCT selection_key) FILTER (WHERE day >= ${from})::int AS selections
        FROM search_stats WHERE shop_id = ${shopId} AND day >= ${before}`,
      prisma.$queryRaw<{ fits: number; no_fit: number; previous: number }[]>`
        SELECT coalesce(sum(fits) FILTER (WHERE day >= ${from}), 0)::int AS fits,
               coalesce(sum(no_fit) FILTER (WHERE day >= ${from}), 0)::int AS no_fit,
               coalesce(sum(fits + no_fit) FILTER (WHERE day < ${from}), 0)::int AS previous
        FROM fit_check_stats WHERE shop_id = ${shopId} AND day >= ${before}`,
      prisma.$queryRaw<{ day: string; searches: number; no_results: number }[]>`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
               coalesce(sum(s.searches), 0)::int AS searches,
               coalesce(sum(s.no_results), 0)::int AS no_results
        FROM generate_series(${from}, ${UTC_TODAY}, interval '1 day') AS d(day)
        LEFT JOIN search_stats s ON s.shop_id = ${shopId} AND s.day = d.day::date
        GROUP BY d.day ORDER BY d.day`,
      selection(Prisma.empty, Prisma.sql`sum(s.searches) DESC`),
      selection(
        Prisma.sql`HAVING sum(s.no_results) > 0`,
        Prisma.sql`sum(s.no_results) DESC`,
      ),
      prisma.$queryRaw<
        {
          product_id: string;
          title: string | null;
          fits: number;
          no_fit: number;
        }[]
      >`
        SELECT t.product_id, c.title, t.fits, t.no_fit FROM (
          SELECT product_id, sum(fits)::int AS fits, sum(no_fit)::int AS no_fit
          FROM fit_check_stats WHERE shop_id = ${shopId} AND day >= ${from}
          GROUP BY product_id
          ORDER BY sum(fits + no_fit) DESC, product_id
          LIMIT ${TOP}) t
        LEFT JOIN catalog_products c
          ON c.shop_id = ${shopId} AND c.product_id = t.product_id AND c.status <> 'DELETED'
        ORDER BY t.fits + t.no_fit DESC, t.product_id`,
      prisma.$queryRaw<{ any: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM search_stats WHERE shop_id = ${shopId})
            OR EXISTS (SELECT 1 FROM fit_check_stats WHERE shop_id = ${shopId}) AS any`,
    ]);

  const stat = (r: (typeof top)[number]): SelectionStat => ({
    picks: r.picks,
    searches: n(r.searches),
    noResults: n(r.no_results),
    lastNoResult: r.last_no_result,
  });
  return {
    hasData: any.any,
    searches: n(totals.searches),
    previousSearches: n(totals.previous),
    noResults: n(totals.no_results),
    selections: n(totals.selections),
    fits: n(checks.fits),
    noFit: n(checks.no_fit),
    previousChecks: n(checks.previous),
    daily: daily.map((d) => ({
      day: d.day,
      searches: n(d.searches),
      noResults: n(d.no_results),
    })),
    topSelections: top.map(stat),
    nothingFound: nothing.map(stat),
    products: products.map((p) => ({
      productId: p.product_id,
      title: p.title,
      fits: n(p.fits),
      noFit: n(p.no_fit),
    })),
  };
}

/** Searches per value of one search field in the period, most searched first. */
export async function fieldValues(
  shopId: string,
  days: Period,
  fieldId: string,
): Promise<{ value: string; searches: number }[]> {
  const rows = await prisma.$queryRaw<{ value: string; searches: number }[]>`
    SELECT picks ->> ${fieldId} AS value, sum(searches)::int AS searches
    FROM search_stats
    WHERE shop_id = ${shopId} AND day >= (${UTC_TODAY} - ${days - 1}::int)
      AND jsonb_exists(picks, ${fieldId})
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${TOP}`;
  return rows.map((r) => ({ value: r.value, searches: n(r.searches) }));
}

/** Daily purge: counts older than KEEP_DAYS, every shop. Returns how many rows went. */
export async function purgeOldStats(): Promise<number> {
  const cutoff = Prisma.sql`(${UTC_TODAY} - ${KEEP_DAYS}::int)`;
  const [searches, checks] = await Promise.all([
    prisma.$executeRaw`DELETE FROM search_stats WHERE day < ${cutoff}`,
    prisma.$executeRaw`DELETE FROM fit_check_stats WHERE day < ${cutoff}`,
  ]);
  return searches + checks;
}
