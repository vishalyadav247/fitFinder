// App proxy GET /apps/sparefit/fits?product={id}&{fieldId}={value}… →
// the fits badge state for the shopper's selection plus the fitment table rows of the product
// (specs/storefront.md › Fits badge, Fitment table). The id is Liquid's numeric product id.
// A check with a full selection is counted for Analytics (specs/analytics.md).
import type { LoaderFunctionArgs } from "react-router";
import { json, proxyContext } from "../services/storefront/proxy.server";
import { isComplete, parsePicks } from "../services/storefront/picks";
import { productFits } from "../services/storefront/query.server";
import { recordFitCheck, track } from "../services/analytics/record.server";

const NUMERIC_ID = /^\d{1,20}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { search, params } = await proxyContext(request);
  const product = params.get("product") ?? "";
  const picks = parsePicks(params, search.fields);
  if (!NUMERIC_ID.test(product) || !picks) {
    return json({ error: "bad_request" }, 400);
  }
  const productId = `gid://shopify/Product/${product}`;
  const result = await productFits(search, productId, picks);
  if (result.state !== "ask" && isComplete(picks, search.fields)) {
    const fits = result.state === "fits";
    track(() => recordFitCheck(search.shopId, productId, fits));
  }
  return json(result, 200, 30);
};
