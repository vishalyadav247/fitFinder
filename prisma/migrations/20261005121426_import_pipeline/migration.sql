/*
  Warnings:

  - You are about to drop the column `error_report_key` on the `import_jobs` table. All the data in the column will be lost.
  - You are about to drop the column `updated` on the `import_jobs` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "ImportStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "import_jobs" DROP COLUMN "error_report_key",
DROP COLUMN "updated",
ADD COLUMN     "columns" JSONB,
ADD COLUMN     "delimiter" TEXT,
ADD COLUMN     "encoding" TEXT,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "file_size" BIGINT,
ADD COLUMN     "imported" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processed_rows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "report_key" TEXT,
ADD COLUMN     "rows_left" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_rows" INTEGER,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "import_rows" (
    "id" BIGSERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "year_from" INTEGER,
    "year_to" INTEGER,
    "attachment" TEXT NOT NULL DEFAULT '',
    "row_hash" TEXT,
    "error" TEXT,
    "raw" JSONB,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_rows_job_id_row_hash_idx" ON "import_rows"("job_id", "row_hash");

-- CreateIndex
CREATE INDEX "import_rows_job_id_line_idx" ON "import_rows"("job_id", "line");

-- CreateIndex
CREATE INDEX "import_jobs_shop_id_status_idx" ON "import_jobs"("shop_id", "status");

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
