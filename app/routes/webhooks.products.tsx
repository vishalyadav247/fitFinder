// products/create, products/update, products/delete (shopify.app.toml): keep the catalog cache and
// the links fresh (specs/product-mapping.md › Data). The request only queues the product
// (Shopify allows 5 s per delivery); the job reads it again from the Admin API and relinks, so
// late, duplicate or out-of-order deliveries and cut-off variant lists can't leave stale data.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../models/shop.server";
import {
  deletedProductId,
  productIdFromWebhook,
} from "../services/linking/catalog.server";
import { queueProductSync } from "../services/jobs.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Raw body for products/delete: its numeric id may not fit a JavaScript number.
  const rawBody = await request.clone().text();
  const { shop, topic, payload } = await authenticate.webhook(request);
  const known = await getShopByDomain(shop);
  if (!known || known.uninstalledAt) return new Response();

  const productId =
    topic === "PRODUCTS_DELETE"
      ? deletedProductId(rawBody)
      : productIdFromWebhook(payload);
  if (!productId) {
    console.warn("products webhook: unexpected payload", { shop, topic });
    return new Response();
  }
  try {
    await queueProductSync(known.id, productId);
  } catch (error) {
    // Shopify retries a failed delivery.
    console.error("products webhook: couldn't queue the product", {
      shop,
      topic,
      productId,
      error,
    });
    throw error;
  }
  return new Response();
};
