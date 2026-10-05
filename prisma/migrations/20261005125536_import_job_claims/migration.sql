-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimed_at" TIMESTAMP(3);
