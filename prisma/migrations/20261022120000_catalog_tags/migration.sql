-- Product tags in the catalog cache (results page filters, specs/storefront.md › Results page).
ALTER TABLE "catalog_products" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Whether the last full catalog sync read tags: false for caches filled before this migration,
-- so the next Storefront visit reloads the catalog once.
ALTER TABLE "catalog_syncs" ADD COLUMN "tags_loaded" BOOLEAN NOT NULL DEFAULT false;
