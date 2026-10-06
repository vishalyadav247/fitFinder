// App proxy GET /apps/fitfinder/results?{fieldId}={value}…&page=n → the results page, as Liquid
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
  picksQuery,
  selectionLabel,
} from "../services/storefront/picks";
import { searchResults } from "../services/storefront/query.server";
import { loadStorefrontConfig } from "../services/storefront/sync.server";
import { resultsLiquid } from "../services/storefront/results-page";

const MAX_PAGE = 1000;

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
  const config = await loadStorefrontConfig(search.shopId);
  if (!config) return json({ error: "not_found" }, 404);

  const complete = isComplete(picks, search.fields);
  let results = complete ? await searchResults(search, picks, page) : null;
  // Past the last page (e.g. rows removed since): show the first page.
  if (results && page > 1 && results.products.length === 0) {
    results = await searchResults(search, picks, 1);
  }
  const query = picksQuery(search.fields, picks);
  const pageHref = (n: number) => {
    const q = new URLSearchParams(query);
    if (n > 1) q.set("page", String(n));
    return `${config.proxy}/results?${q}`;
  };
  return liquidPage(
    resultsLiquid({
      config,
      picks: Object.fromEntries(query),
      label: selectionLabel(search.fields, picks),
      complete,
      results,
      pageHref,
    }),
  );
}
