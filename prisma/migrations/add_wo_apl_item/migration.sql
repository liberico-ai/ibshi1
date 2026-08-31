-- Giao WO theo ITEM thay vì theo từng dòng vàng (1 ITEM = 1 WO = 1 xưởng).
-- Giữ apl_line_id cho các WO cũ đã phát hành theo dòng vàng.
ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "apl_import_id" TEXT,
  ADD COLUMN IF NOT EXISTS "apl_item" TEXT;

CREATE INDEX IF NOT EXISTS "work_orders_apl_import_id_apl_item_idx"
  ON "work_orders"("apl_import_id", "apl_item");

-- WO cũ: suy ngược import + item từ dòng vàng đã gắn, để phần đọc theo ITEM vẫn thấy chúng.
UPDATE "work_orders" w
SET "apl_import_id" = l."import_id", "apl_item" = l."item"
FROM "apl_lines" l
WHERE w."apl_line_id" = l."id" AND w."apl_import_id" IS NULL;
