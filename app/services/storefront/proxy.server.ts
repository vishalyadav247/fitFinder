// Shared start of every app proxy request (/apps/fitfinder/* → /proxy/*): verify Shopify's
// signature (authenticate.public.appProxy throws 400 otherwise; it also rejects timestamps more
// than 90 s off), then load the shop's search setup. Shops that are unknown, uninstalled or not
// set up get 404, so a removed app stops serving the storefront.
// Docs: https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
import { authenticate } from "../../shopify.server";
import { shopSearch, type ShopSearch } from "./query.server";

export interface ProxyContext {
  search: ShopSearch;
  params: URLSearchParams;
}

export async function proxyContext(request: Request): Promise<ProxyContext> {
  await authenticate.public.appProxy(request);
  const params = new URL(request.url).searchParams;
  const shop = params.get("shop");
  const search = shop ? await shopSearch(shop) : null;
  if (!search) throw json({ error: "not_found" }, 404);
  return { search, params };
}

export function json(body: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Per shopper only; short, so imports and edits show up quickly.
      "Cache-Control": maxAge ? `private, max-age=${maxAge}` : "no-store",
    },
  });
}

/** A Liquid page Shopify renders inside the shop's theme layout. */
export function liquidPage(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/liquid",
      "Cache-Control": "no-store",
    },
  });
}
