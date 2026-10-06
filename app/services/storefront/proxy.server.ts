// Shared start of every app proxy request (/apps/fitfinder/* → /proxy/*): verify Shopify's
// signature (authenticate.public.appProxy throws 400 otherwise; it also rejects timestamps more
// than 90 s off), take one request from the shop's budget (429 when used up), then load the shop's
// search setup. Shops that are unknown, uninstalled or not set up get 404, so a removed app stops
// serving the storefront.
// Docs: https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
import { authenticate } from "../../shopify.server";
import { checkShopRate, withQuerySlot } from "./limits.server";
import { json } from "./proxy-response";
import { shopSearch, type ShopSearch } from "./query.server";

export { json, liquidPage } from "./proxy-response";

export interface ProxyContext {
  search: ShopSearch;
  params: URLSearchParams;
}

export async function proxyContext(request: Request): Promise<ProxyContext> {
  await authenticate.public.appProxy(request);
  const params = new URL(request.url).searchParams;
  const shop = params.get("shop");
  if (!shop) throw json({ error: "not_found" }, 404);
  checkShopRate(shop);
  const search = await withQuerySlot(() => shopSearch(shop));
  if (!search) throw json({ error: "not_found" }, 404);
  return { search, params };
}
