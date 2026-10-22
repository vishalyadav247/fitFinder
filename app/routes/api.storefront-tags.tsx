// GET /api/storefront-tags?q=… — the store's product tags for the Results page tab's filter
// groups (Add / Edit filter group modal): tags of active products, most products first.
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { storeTags } from "../services/storefront/store-tags.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json({ tags: await storeTags(shop.id, q) });
  } catch (error) {
    console.error("storefront tags: read failed", {
      shop: session.shop,
      error,
    });
    return Response.json(
      { tags: [], error: "Tags couldn't be loaded." },
      { status: 500 },
    );
  }
};
