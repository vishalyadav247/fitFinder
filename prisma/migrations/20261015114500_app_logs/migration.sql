-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('error', 'warn', 'slow');

-- CreateTable
CREATE TABLE "app_logs" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "shop_domain" TEXT,
    "path" TEXT,
    "duration_ms" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backoffice_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backoffice_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "app_logs_last_at_idx" ON "app_logs"("last_at");

-- CreateIndex
CREATE INDEX "app_logs_level_last_at_idx" ON "app_logs"("level", "last_at");

-- CreateIndex
CREATE INDEX "app_logs_shop_domain_last_at_idx" ON "app_logs"("shop_domain", "last_at");

-- CreateIndex
CREATE INDEX "app_logs_fingerprint_last_at_idx" ON "app_logs"("fingerprint", "last_at");
