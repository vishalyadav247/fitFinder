// App proxy GET /apps/fitfinder/options?field={id}&{fieldId}={value}… → { options: string[] }:
// the values for one dropdown given the picks of the fields before it (specs/storefront.md).
import type { LoaderFunctionArgs } from "react-router";
import { json, proxyContext } from "../services/storefront/proxy.server";
import { parsePicks } from "../services/storefront/picks";
import { fieldOptions } from "../services/storefront/query.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { search, params } = await proxyContext(request);
  const index = search.fields.findIndex((f) => f.id === params.get("field"));
  const picks = parsePicks(params, search.fields);
  if (index < 0 || !picks) return json({ error: "bad_request" }, 400);
  const options = await fieldOptions(search, index, picks);
  return json({ options }, 200, 30);
};
