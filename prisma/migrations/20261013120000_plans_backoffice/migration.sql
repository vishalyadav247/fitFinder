-- Plans move from code to the database and billing to the Billing API (agreed 2026-10-13):
-- the backoffice edits the four plans (price, free, trial days, limits, features), and the app
-- records each charge it creates so a Shopify subscription maps back to a plan.

-- AlterTable
ALTER TABLE "shops" ALTER COLUMN "plan" SET DEFAULT 'none',
ADD COLUMN "subscription_id" TEXT;

-- CreateTable
CREATE TABLE "plans" (
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_free" BOOLEAN NOT NULL DEFAULT false,
    "price_monthly" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "price_yearly" DECIMAL(10,2),
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "toggles" JSONB NOT NULL DEFAULT '{}',
    "bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "app_subscriptions" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "shopify_id" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "trial_days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "activated_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_subscriptions_shopify_id_key" ON "app_subscriptions"("shopify_id");

-- CreateIndex
CREATE INDEX "app_subscriptions_shop_id_idx" ON "app_subscriptions"("shop_id");

-- AddForeignKey
ALTER TABLE "app_subscriptions" ADD CONSTRAINT "app_subscriptions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The four plans with the values the code had (Business is a new, hidden slot). A limit of null
-- is unlimited; search fields stay capped at 20 in code.
INSERT INTO "plans" ("key", "position", "name", "description", "is_free", "price_monthly", "price_yearly", "trial_days", "visible", "limits", "toggles", "bullets") VALUES
('starter', 1, 'Starter', 'For trying SpareFit on a small catalog.', true, 0, NULL, 0, true,
  '{"rows": 5000, "products": 50, "searchFields": null, "backups": 5}',
  '{"fitsBadge": true, "fitmentTable": false, "mySelection": false, "universalProducts": false, "prioritySupport": false}',
  ARRAY['Search section', 'CSV import with column mapping']),
('growth', 2, 'Growth', 'For growing catalogs.', false, 29, 290, 14, true,
  '{"rows": 500000, "products": 5000, "searchFields": null, "backups": 5}',
  '{"fitsBadge": true, "fitmentTable": true, "mySelection": true, "universalProducts": true, "prioritySupport": false}',
  ARRAY['Everything in Starter']),
('pro', 3, 'Pro', 'For large catalogs.', false, 99, 990, 14, true,
  '{"rows": null, "products": null, "searchFields": null, "backups": 5}',
  '{"fitsBadge": true, "fitmentTable": true, "mySelection": true, "universalProducts": true, "prioritySupport": true}',
  ARRAY['Everything in Growth']),
('business', 4, 'Business', 'For the largest catalogs.', false, 199, 1990, 14, false,
  '{"rows": null, "products": null, "searchFields": null, "backups": 20}',
  '{"fitsBadge": true, "fitmentTable": true, "mySelection": true, "universalProducts": true, "prioritySupport": true}',
  ARRAY['Everything in Pro']);
