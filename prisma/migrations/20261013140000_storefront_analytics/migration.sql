-- Storefront analytics (specs/analytics.md): daily counts per selection and per product.
-- Counts only; nothing about the shopper.

-- CreateTable
CREATE TABLE "search_stats" (
    "shop_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "selection_key" TEXT NOT NULL,
    "picks" JSONB NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "no_results" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "search_stats_pkey" PRIMARY KEY ("shop_id","day","selection_key")
);

-- CreateTable
CREATE TABLE "fit_check_stats" (
    "shop_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "product_id" TEXT NOT NULL,
    "fits" INTEGER NOT NULL DEFAULT 0,
    "no_fit" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fit_check_stats_pkey" PRIMARY KEY ("shop_id","day","product_id")
);

-- AddForeignKey
ALTER TABLE "search_stats" ADD CONSTRAINT "search_stats_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fit_check_stats" ADD CONSTRAINT "fit_check_stats_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
