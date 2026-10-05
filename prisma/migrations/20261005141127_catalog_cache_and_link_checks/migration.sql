-- CreateEnum
CREATE TYPE "LinkCheckStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "catalog_products" (
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("shop_id","product_id")
);

-- CreateTable
CREATE TABLE "catalog_variants" (
    "shop_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "sku_key" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "catalog_variants_pkey" PRIMARY KEY ("shop_id","variant_id")
);

-- CreateTable
CREATE TABLE "catalog_collections" (
    "shop_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "catalog_collections_pkey" PRIMARY KEY ("shop_id","collection_id")
);

-- CreateTable
CREATE TABLE "catalog_syncs" (
    "shop_id" TEXT NOT NULL,
    "status" "LinkCheckStatus" NOT NULL DEFAULT 'queued',
    "full_sync" BOOLEAN NOT NULL DEFAULT true,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "bulk_operation_id" TEXT,
    "new_matches" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_syncs_pkey" PRIMARY KEY ("shop_id")
);

-- CreateIndex
CREATE INDEX "catalog_products_shop_id_handle_idx" ON "catalog_products"("shop_id", "handle");

-- CreateIndex
CREATE INDEX "catalog_products_shop_id_title_idx" ON "catalog_products"("shop_id", "title");

-- CreateIndex
CREATE INDEX "catalog_variants_shop_id_sku_key_idx" ON "catalog_variants"("shop_id", "sku_key");

-- CreateIndex
CREATE INDEX "catalog_variants_shop_id_product_id_idx" ON "catalog_variants"("shop_id", "product_id");

-- CreateIndex
CREATE INDEX "catalog_collections_shop_id_handle_idx" ON "catalog_collections"("shop_id", "handle");

-- AddForeignKey
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_collections" ADD CONSTRAINT "catalog_collections_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_syncs" ADD CONSTRAINT "catalog_syncs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
