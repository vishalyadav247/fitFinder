// App proxy GET /apps/fitfinder/search?{fieldId}={value}… → where "Show {products}" goes
// (specs/storefront.md › Results): { mode: "search", q } = the theme's own search page for the
// SKUs that fit (the theme's product cards and filters), or { mode: "page" } = FitFinder's
// results page (nothing fits, or more SKUs than one search takes).
import type { LoaderFunctionArgs } from "react-router";
import { json, proxyContext } from "../services/storefront/proxy.server";
import { isComplete, parsePicks } from "../services/storefront/picks";
import { fitSkus } from "../services/storefront/query.server";
import {
  MAX_SEARCH_SKUS,
  searchPlan,
} from "../services/storefront/search-query";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { search, params } = await proxyContext(request);
  const picks = parsePicks(params, search.fields);
  if (!picks || !isComplete(picks, search.fields)) {
    return json({ error: "bad_request" }, 400);
  }
  const plan = searchPlan(await fitSkus(search, picks, MAX_SEARCH_SKUS));
  return json(plan, 200, 30);
};
