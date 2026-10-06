-- Product mapping's unlinked groups (GROUP BY attachment, min(id)) read the attachment index
-- only, without visiting the table: (shop_id, attachment) becomes (shop_id, attachment, id).
-- Every lookup by (shop_id, attachment) keeps using it (same leading columns).

-- DropIndex
DROP INDEX "fitment_rows_shop_id_attachment_idx";

-- CreateIndex
CREATE INDEX "fitment_rows_shop_id_attachment_id_idx" ON "fitment_rows"("shop_id", "attachment", "id");
