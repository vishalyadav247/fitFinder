-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('automotive', 'phones', 'beauty', 'custom');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('list', 'year_range');

-- CreateEnum
CREATE TYPE "LinkKind" AS ENUM ('sku', 'product', 'collection');

-- CreateEnum
CREATE TYPE "LinkMethod" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('upsert', 'replace', 'delete');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'previewing', 'ready', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "trial_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_configs" (
    "shop_id" TEXT NOT NULL,
    "store_type" "StoreType" NOT NULL,
    "heading" TEXT NOT NULL,
    "noun" TEXT NOT NULL,
    "things_word" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_configs_pkey" PRIMARY KEY ("shop_id")
);

-- CreateTable
CREATE TABLE "search_fields" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "placeholder" TEXT NOT NULL DEFAULT '',
    "type" "FieldType" NOT NULL DEFAULT 'list',
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "search_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fitment_rows" (
    "id" BIGSERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "attachment" TEXT NOT NULL,
    "row_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fitment_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_links" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "attachment" TEXT NOT NULL,
    "kind" "LinkKind" NOT NULL,
    "product_id" TEXT,
    "variant_id" TEXT,
    "collection_id" TEXT,
    "method" "LinkMethod" NOT NULL DEFAULT 'auto',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universal_products" (
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "universal_products_pkey" PRIMARY KEY ("shop_id","product_id")
);

-- CreateTable
CREATE TABLE "import_mappings" (
    "shop_id" TEXT NOT NULL,
    "column_name" TEXT NOT NULL,
    "target" TEXT NOT NULL,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("shop_id","column_name")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT,
    "mode" "ImportMode" NOT NULL DEFAULT 'upsert',
    "mapping" JSONB,
    "look_for_skus" BOOLEAN NOT NULL DEFAULT true,
    "has_header" BOOLEAN NOT NULL DEFAULT true,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "not_found" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "error_report_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_settings" (
    "shop_id" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_settings_pkey" PRIMARY KEY ("shop_id")
);

-- CreateTable
CREATE TABLE "theme_status" (
    "shop_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "embed_on" BOOLEAN NOT NULL DEFAULT false,
    "blocks" JSONB NOT NULL DEFAULT '{}',
    "table_code_found" BOOLEAN NOT NULL DEFAULT false,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theme_status_pkey" PRIMARY KEY ("shop_id","theme_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_domain_key" ON "shops"("domain");

-- CreateIndex
CREATE INDEX "shops_uninstalled_at_idx" ON "shops"("uninstalled_at");

-- CreateIndex
CREATE INDEX "search_fields_shop_id_position_idx" ON "search_fields"("shop_id", "position");

-- CreateIndex
CREATE INDEX "fitment_rows_shop_id_attachment_idx" ON "fitment_rows"("shop_id", "attachment");

-- CreateIndex
CREATE INDEX "fitment_rows_values_idx" ON "fitment_rows" USING GIN ("values" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "fitment_rows_shop_id_row_hash_key" ON "fitment_rows"("shop_id", "row_hash");

-- CreateIndex
CREATE INDEX "product_links_shop_id_product_id_idx" ON "product_links"("shop_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_links_shop_id_attachment_key" ON "product_links"("shop_id", "attachment");

-- CreateIndex
CREATE INDEX "import_jobs_shop_id_created_at_idx" ON "import_jobs"("shop_id", "created_at");

-- AddForeignKey
ALTER TABLE "search_configs" ADD CONSTRAINT "search_configs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_fields" ADD CONSTRAINT "search_fields_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fitment_rows" ADD CONSTRAINT "fitment_rows_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universal_products" ADD CONSTRAINT "universal_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_settings" ADD CONSTRAINT "storefront_settings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theme_status" ADD CONSTRAINT "theme_status_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
