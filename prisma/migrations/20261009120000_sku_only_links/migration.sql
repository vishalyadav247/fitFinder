-- Attachments are variant SKUs only (agreed 2026-10-09): matching by product link, product handle
-- or collection link is removed, with the collections cache and the import's "Look for SKUs"
-- option (it never changed matching).

-- Links to a collection have no product to keep.
DELETE FROM "product_links" WHERE "product_id" IS NULL;

-- Automatic links made through a product link or handle. Manual links stay; the next link check
-- matches SKUs again.
DELETE FROM "product_links" WHERE "method" = 'auto' AND "kind" = 'product';

-- DropForeignKey
ALTER TABLE "catalog_collections" DROP CONSTRAINT "catalog_collections_shop_id_fkey";

-- DropIndex
DROP INDEX "product_links_shop_id_collection_id_idx";

-- AlterTable
ALTER TABLE "import_jobs" DROP COLUMN "look_for_skus";

-- AlterTable
ALTER TABLE "product_links" DROP COLUMN "collection_id",
DROP COLUMN "kind",
ALTER COLUMN "product_id" SET NOT NULL;

-- DropTable
DROP TABLE "catalog_collections";

-- DropEnum
DROP TYPE "LinkKind";
