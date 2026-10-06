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

export const loader = async ({ request }: LoaderFunctionArgs) => {
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
};
