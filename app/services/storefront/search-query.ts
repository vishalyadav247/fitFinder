// The theme search page query for a selection's SKUs (specs/storefront.md › Results). Pure.
// Storefront search accepts field-scoped phrase queries joined with OR
// (https://shopify.dev/docs/api/usage/search-syntax); the exact field name and how many terms a
// search takes are checked on a dev store (PROGRESS.md › M7 manual checks): change SKU_FIELD /
// MAX_SEARCH_SKUS here if needed.
export const SKU_FIELD = "variants.sku";
export const MAX_SEARCH_SKUS = 100;
/** Encoded length of q; stays well inside common URL limits with the rest of the URL. */
export const MAX_QUERY_LENGTH = 6000;

export type SearchPlan =
  | { mode: "search"; q: string; skus: number; missing: number }
  | { mode: "page"; reason: "none" | "too-many" | "unsearchable" };

// A SKU with a quote or backslash can't sit inside a phrase query.
const SEARCHABLE = /^[^"\\]+$/;

/**
 * Search the theme for the SKUs, or use FitFinder's own results page when nothing fits or the
 * list is too long for one search. Products without a usable SKU can't be searched for; they are
 * left out and counted in `missing`.
 */
export function searchPlan(found: {
  skus: string[];
  products: number;
  withoutSku: number;
}): SearchPlan {
  if (found.products === 0) return { mode: "page", reason: "none" };
  const skus = found.skus.filter((s) => SEARCHABLE.test(s));
  const missing = found.withoutSku + (found.skus.length - skus.length);
  // Only SKU-less products fit: our page lists them (it doesn't need SKUs).
  if (skus.length === 0) return { mode: "page", reason: "unsearchable" };
  if (found.products - found.withoutSku > MAX_SEARCH_SKUS) {
    return { mode: "page", reason: "too-many" };
  }
  const q = skus.map((s) => `${SKU_FIELD}:"${s}"`).join(" OR ");
  if (encodeURIComponent(q).length > MAX_QUERY_LENGTH) {
    return { mode: "page", reason: "too-many" };
  }
  return { mode: "search", q, skus: skus.length, missing };
}
