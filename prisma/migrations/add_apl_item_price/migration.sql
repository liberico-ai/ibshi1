-- Đơn giá khoán nhập theo ITEM (1 ITEM = 1 WO = 1 xưởng).
-- apl_line_prices giữ nguyên, dùng để đặt giá riêng cho một dòng chi tiết khi cần.
CREATE TABLE IF NOT EXISTS "apl_item_prices" (
  "id"         TEXT NOT NULL,
  "import_id"  TEXT NOT NULL,
  "item"       TEXT NOT NULL,
  "unit_price" DECIMAL(65,30) NOT NULL,
  "note"       TEXT,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "apl_item_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "apl_item_prices_import_id_item_key"
  ON "apl_item_prices"("import_id", "item");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apl_item_prices_import_id_fkey') THEN
    ALTER TABLE "apl_item_prices" ADD CONSTRAINT "apl_item_prices_import_id_fkey"
      FOREIGN KEY ("import_id") REFERENCES "apl_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Đơn giá cũ gắn vào DÒNG VÀNG không còn chỗ hiển thị (bảng nay theo ITEM, xổ ra dòng chi tiết).
-- Nâng chúng lên thành đơn giá của ITEM tương ứng để không mất số đã nhập.
INSERT INTO "apl_item_prices" ("id", "import_id", "item", "unit_price", "updated_by", "created_at", "updated_at")
SELECT
  md5(random()::text || clock_timestamp()::text),
  p."import_id",
  COALESCE(l."item", ''),
  AVG(p."unit_price"),
  MIN(p."updated_by"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "apl_line_prices" p
JOIN "apl_lines" l ON l."id" = p."apl_line_id"
WHERE l."is_assembly" = TRUE
GROUP BY p."import_id", COALESCE(l."item", '')
ON CONFLICT ("import_id", "item") DO NOTHING;

-- Dọn đơn giá gắn dòng vàng: đã chuyển lên mức ITEM, để lại thì thành số mồ côi.
DELETE FROM "apl_line_prices" p
USING "apl_lines" l
WHERE l."id" = p."apl_line_id" AND l."is_assembly" = TRUE;
