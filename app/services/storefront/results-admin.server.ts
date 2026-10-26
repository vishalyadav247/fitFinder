// The Storefront page's Results page tab (specs/storefront.md › Results page tab): the saved
// settings and products for the live preview (the tag picker reads /api/storefront-tags).
// Every query is scoped by shop.
import prisma from "../../db.server";
import { getResultsPage } from "../../models/storefront-settings.server";
import { requestLinkCheck } from "../jobs.server";
import type { ResultsPageSettings } from "./results-settings";

/** Products the preview shows (and counts its filter values from). */
export const PREVIEW_PRODUCTS = 24;
// A failed catalog reload is tried again on a later visit, not on every one.
const RETRY_AFTER_MS = 60 * 60_000;

export interface ResultsAdminData {
  settings: ResultsPageSettings;
  sample: { title: string; tags: string[]; sku: string }[];
  /** Tags are still being read from Shopify (catalog filled before tags were kept, or never). */
  tagsLoading: boolean;
}

export async function resultsAdminData(
  shopId: string,
): Promise<ResultsAdminData> {
  const [settings, sample, sync] = await Promise.all([
    getResultsPage(shopId),
    // With each product's first SKU, for the cards' "SKU" line.
    prisma.$queryRaw<{ title: string; tags: string[]; sku: string }[]>`
      SELECT p.title, p.tags,
             coalesce((SELECT v.sku FROM catalog_variants v
                       WHERE v.shop_id = p.shop_id AND v.product_id = p.product_id AND v.sku <> ''
                       ORDER BY v.variant_id LIMIT 1), '') AS sku
      FROM catalog_products p
      WHERE p.shop_id = ${shopId} AND p.status = 'ACTIVE'
      ORDER BY cardinality(p.tags) > 0 DESC, p.title, p.product_id
      LIMIT ${PREVIEW_PRODUCTS}`,
    prisma.catalogSync.findUnique({
      where: { shopId },
      select: { status: true, tagsLoaded: true, finishedAt: true },
    }),
  ]);
  const busy = sync?.status === "queued" || sync?.status === "running";
  let tagsLoading = !sync?.tagsLoaded;
  const failedLately =
    sync?.status === "failed" &&
    !!sync.finishedAt &&
    Date.now() - sync.finishedAt.getTime() < RETRY_AFTER_MS;
  if (tagsLoading && !busy && !failedLately) {
    try {
      await requestLinkCheck(shopId, { fullSync: true });
    } catch (error) {
      console.error("results page: couldn't queue the catalog reload", {
        shopId,
        error,
      });
      tagsLoading = false;
    }
  }
  if (failedLately) tagsLoading = false;
  return { settings, sample, tagsLoading };
}
