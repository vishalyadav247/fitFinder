// The theme search page query for a selection's SKUs (specs/storefront.md › Results). Pure.
// Storefront search accepts field-scoped phrase queries joined with OR
// (https://shopify.dev/docs/api/usage/search-syntax); the exact field name and how many terms a
// search takes are checked on a dev store (PROGRESS.md › M7 manual checks): change SKU_FIELD /
// MAX_SEARCH_SKUS here if needed.
export const SKU_FIELD = "variants.sku";
/** SKUs read per search; the link takes as many of them as fit in MAX_QUERY_LENGTH. */
export const MAX_SEARCH_SKUS = 500;
/** Encoded length of q; stays well inside common URL limits with the rest of the URL. */
export const MAX_QUERY_LENGTH = 6000;
/** A query that finds nothing: the theme shows its own "no results" page. */
export const NO_MATCH_QUERY = `${SKU_FIELD}:"sparefit-no-match"`;

export interface SearchPlan {
  mode: "search";
  q: string;
  /** SKUs in the link. */
  skus: number;
  /** Fitting products not in the link: no usable SKU, or past the URL length. */
  missing: number;
}

// A SKU with a quote or backslash can't sit inside a phrase query.
const SEARCHABLE = /^[^"\\]+$/;

/**
 * The theme's search page for the SKUs that fit (setting "Show results on": Default search page,
 * always; agreed 2026-10-16, no switch to SpareFit's page). As many SKUs as fit in one link;
 * nothing that fits, or only products without a usable SKU: a query that finds nothing.
 */
export function searchPlan(found: {
  skus: string[];
  products: number;
  withoutSku: number;
}): SearchPlan {
  const terms: string[] = [];
  let length = 0;
  for (const sku of found.skus) {
    if (!SEARCHABLE.test(sku)) continue;
    const term = `${SKU_FIELD}:"${sku}"`;
    const add = encodeURIComponent(terms.length ? ` OR ${term}` : term).length;
    if (length + add > MAX_QUERY_LENGTH) break;
    terms.push(term);
    length += add;
  }
  return {
    mode: "search",
    q: terms.length ? terms.join(" OR ") : NO_MATCH_QUERY,
    skus: terms.length,
    missing: Math.max(0, found.products - terms.length),
  };
}
