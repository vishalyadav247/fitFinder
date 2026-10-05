-- DropIndex
DROP INDEX "import_rows_job_id_line_idx";

-- CreateIndex
CREATE INDEX "import_rows_job_id_id_idx" ON "import_rows"("job_id", "id");
