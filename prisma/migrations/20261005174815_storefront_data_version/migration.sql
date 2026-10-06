-- AlterTable
ALTER TABLE "search_configs" ADD COLUMN     "data_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "storefront_settings" ADD COLUMN     "published_hash" TEXT;
