// App proxy GET /apps/sparefit/results?{fieldId}={value}…&page=n → the results page, as Liquid
// rendered in the shop's theme (services/storefront/results-page.ts).
import type { LoaderFunctionArgs } from "react-router";
import {
  json,
  liquidPage,
  proxyContext,
} from "../services/storefront/proxy.server";
import {
  isComplete,
  parsePicks,
  picksLinkQuery,
  picksQuery,
  selectionLabel,
} from "../services/storefront/picks";
import { searchResults } from "../services/storefront/query.server";
import { loadStorefrontConfig } from "../services/storefront/sync.server";
import {
  resultsLiquid,
  type ResultsState,
} from "../services/storefront/results-page";
import {
  filterPicksFrom,
  productsPerPage,
  SORTS,
} from "../services/storefront/results-settings";
import { getResultsPage } from "../models/storefront-settings.server";

const MAX_PAGE = 1000;
const PROXY_PREFIX = /^\/(apps|a|community|tools)\/[A-Za-z0-9_-]{1,64}$/;

/**
 * A shopper's page load, not a script call: when the store is over its request budget or no
 * query slot frees up, show a short page in the theme instead of the JSON error.
 */
export const loader = async (args: LoaderFunctionArgs) => {
  try {
    return await page(args);
  } catch (error) {
    if (
      error instanceof Response &&
      (error.status === 429 || error.status === 503)
    ) {
      const busy = liquidPage(BUSY_PAGE);
      busy.headers.set("Retry-After", error.headers.get("Retry-After") ?? "2");
      return busy;
    }
    throw error;
  }
};

export const BUSY_PAGE =
  '<div class="page-width" style="padding:48px 0"><p>The search is very busy right now. Please try again in a moment.</p></div>';

async function page({ request }: LoaderFunctionArgs) {
  const { search, params } = await proxyContext(request);
  const picks = parsePicks(params, search.fields);
  const pageText = params.get("page") ?? "1";
  const page = /^\d{1,4}$/.test(pageText) ? Number(pageText) : 0;
  if (!picks || page < 1 || page > MAX_PAGE) {
    return json({ error: "bad_request" }, 400);
  }
  const [stored, settings] = await Promise.all([
    loadStorefrontConfig(search.shopId),
    getResultsPage(search.shopId),
  ]);
  if (!stored) return json({ error: "not_found" }, 404);
  // Links and the sort form use the proxy path Shopify sent (signed; merchants can rename the
  // prefix and subpath), else the default one.
  const prefix = params.get("path_prefix") ?? "";
  const config = PROXY_PREFIX.test(prefix)
    ? { ...stored, proxy: prefix }
    : stored;

  const sortText = params.get("sort");
  const state: ResultsState = {
    filterPicks: filterPicksFrom(params, settings.filters),
    sort: SORTS.some(([k]) => k === sortText)
      ? (sortText as ResultsState["sort"])
      : settings.sort,
    page,
  };
  const options = {
    filters: settings.filters,
    filterPicks: state.filterPicks,
    sort: state.sort,
    perPage: productsPerPage(settings),
  };
  const complete = isComplete(picks, search.fields);
  let results = complete
    ? await searchResults(search, picks, page, options)
    : null;
  // Past the last page (e.g. rows removed since): show the first page.
  if (results && page > 1 && results.products.length === 0) {
    results = await searchResults(search, picks, 1, options);
    state.page = 1;
  }
  const query = picksQuery(search.fields, picks);
  const linkQuery = [...picksLinkQuery(search.fields, picks)];
  const href = (next: ResultsState) => {
    const q = new URLSearchParams(linkQuery);
    for (const f of settings.filters) {
      for (const v of next.filterPicks[f.id] ?? []) q.append(`f_${f.id}`, v);
    }
    if (next.sort !== settings.sort) q.set("sort", next.sort);
    if (next.page > 1) q.set("page", String(next.page));
    return `${config.proxy}/results?${q}`;
  };
  return liquidPage(
    resultsLiquid({
      config,
      picks: Object.fromEntries(query),
      label: selectionLabel(search.fields, picks),
      complete,
      results,
      settings,
      state,
      href,
      pickQuery: linkQuery,
    }),
  );
}
