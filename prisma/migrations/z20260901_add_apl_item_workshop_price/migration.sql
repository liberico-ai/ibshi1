-- Đơn giá khoán theo TỪNG XƯỞNG trong một ITEM của APL.
-- Một ITEM giao nhiều xưởng, mỗi xưởng làm một khâu và nhận trọn khối lượng ITEM.
-- Tiền của xưởng = KL đã nghiệm thu × đơn giá của xưởng; cộng lại không vượt
-- TRẦN của hạng mục = đơn giá ITEM × KL ITEM.
CREATE TABLE IF NOT EXISTS "apl_item_workshop_prices" (
  "id"         TEXT NOT NULL,
  "import_id"  TEXT NOT NULL,
  "item"       TEXT NOT NULL,
  "team_code"  TEXT NOT NULL,
  "unit_price" DECIMAL(65,30) NOT NULL,
  "note"       TEXT,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "apl_item_workshop_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "apl_item_workshop_prices_import_id_item_team_code_key"
  ON "apl_item_workshop_prices" ("import_id", "item", "team_code");

DO $$ BEGIN
  ALTER TABLE "apl_item_workshop_prices"
    ADD CONSTRAINT "apl_item_workshop_prices_import_id_fkey"
    FOREIGN KEY ("import_id") REFERENCES "apl_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
