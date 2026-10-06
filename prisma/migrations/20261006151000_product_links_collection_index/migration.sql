-- The storefront's fits lookup (product page) finds a product's links by product OR by the
-- collections it is in: without this index the OR read every shop's links (sequential scan).

-- CreateIndex
CREATE INDEX "product_links_shop_id_collection_id_idx" ON "product_links"("shop_id", "collection_id");
