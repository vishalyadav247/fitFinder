// Storefront analytics, recorded by the app proxy routes (specs/analytics.md): daily counts per
// selection ("Show {products}" clicks) and per product (fits badge checks). Counts only, nothing
// about the shopper. Recording never holds up or fails the shopper's request: the routes call
// `track`, which runs the write after answering and only logs a failure.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { withQuerySlot } from "../storefront/limits.server";
import { picksKey, picksQuery, type Picks } from "../storefront/picks";
import { picksWhere, type ShopSearch } from "../storefront/query.server";

/** Today in UTC: the day every count is filed under. */
const TODAY = Prisma.sql`(now() AT TIME ZONE 'UTC')::date`;

/** Runs a recording in the background; a failure (or a busy store) only loses that count. */
export function track(record: () => Promise<unknown>): void {
  void withQuerySlot(record).catch((error) => {
    // A busy store refuses the slot with a 503 response: expected, not worth a log line.
    if (error instanceof Response) return;
    console.error("analytics: count not recorded", error);
  });
}

/**
 * One "Show {products}" click for a full selection. `specific` = fitting products that aren't
 * universal; 0 counts as "nothing found". Made-up selections (no filter row matches them, so no
 * shopper could pick them in the dropdowns) aren't recorded, so stray requests can't fill the
 * merchant's lists.
 */
export async function recordSearch(
  search: ShopSearch,
  picks: Picks,
  specific: number,
): Promise<boolean> {
  const { shopId } = search;
  if (specific === 0) {
    const [row] = await prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM fitment_rows f
      WHERE f.shop_id = ${shopId} ${picksWhere(search.fields, picks)}
      LIMIT 1`;
    if (!row) return false;
  }
  const values = Object.fromEntries(picksQuery(search.fields, picks));
  const key = createHash("md5").update(picksKey(picks)).digest("hex");
  const none = specific === 0 ? 1 : 0;
  await prisma.$executeRaw`
    INSERT INTO search_stats (shop_id, day, selection_key, picks, searches, no_results)
    VALUES (${shopId}, ${TODAY}, ${key}, ${JSON.stringify(values)}::jsonb, 1, ${none})
    ON CONFLICT (shop_id, day, selection_key) DO UPDATE SET
      searches = search_stats.searches + 1,
      no_results = search_stats.no_results + EXCLUDED.no_results`;
  return true;
}

/**
 * One fits badge check of a product with the shopper's selection. Only products in the shop's
 * catalog are counted (a made-up product id adds nothing).
 */
export async function recordFitCheck(
  shopId: string,
  productId: string,
  fits: boolean,
): Promise<boolean> {
  const added = await prisma.$executeRaw`
    INSERT INTO fit_check_stats (shop_id, day, product_id, fits, no_fit)
    SELECT ${shopId}, ${TODAY}, ${productId}, ${fits ? 1 : 0}, ${fits ? 0 : 1}
    WHERE EXISTS (SELECT 1 FROM catalog_products c
                  WHERE c.shop_id = ${shopId} AND c.product_id = ${productId})
    ON CONFLICT (shop_id, day, product_id) DO UPDATE SET
      fits = fit_check_stats.fits + EXCLUDED.fits,
      no_fit = fit_check_stats.no_fit + EXCLUDED.no_fit`;
  return added > 0;
}
