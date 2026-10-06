// App proxy GET /apps/fitfinder/fits?product={id}&collections={id,id}&{fieldId}={value}… →
// the fits badge state for the shopper's selection plus the fitment table rows of the product
// (specs/storefront.md › Fits badge, Fitment table). Ids are Liquid's numeric ids.
import type { LoaderFunctionArgs } from "react-router";
import { json, proxyContext } from "../services/storefront/proxy.server";
import { parsePicks } from "../services/storefront/picks";
import { productFits } from "../services/storefront/query.server";

const NUMERIC_ID = /^\d{1,20}$/;
const MAX_COLLECTIONS = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { search, params } = await proxyContext(request);
  const product = params.get("product") ?? "";
  const collections = (params.get("collections") ?? "")
    .split(",")
    .filter(Boolean);
  const picks = parsePicks(params, search.fields);
  if (
    !NUMERIC_ID.test(product) ||
    collections.length > MAX_COLLECTIONS ||
    !collections.every((id) => NUMERIC_ID.test(id)) ||
    !picks
  ) {
    return json({ error: "bad_request" }, 400);
  }
  const result = await productFits(
    search,
    `gid://shopify/Product/${product}`,
    collections.map((id) => `gid://shopify/Collection/${id}`),
    picks,
  );
  return json(result, 200, 30);
};
