-- When Shopify created each product (results page sort Newest / Oldest, specs/storefront.md).
ALTER TABLE "catalog_products" ADD COLUMN "shopify_created_at" TIMESTAMP(3);

-- Caches filled before this column existed have no dates: the next Storefront visit reloads the
-- catalog once (the same flag the tags migration uses). Until then Newest / Oldest fall back to
-- the product id order.
UPDATE "catalog_syncs" SET "tags_loaded" = false;
