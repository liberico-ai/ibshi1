-- Đơn giá khoán đặt theo CÔNG ĐOẠN của lệnh, thay cho đặt theo cả hạng mục.
-- '' = lệnh chạy nguyên khối (giá cho cả lệnh của xưởng đó).
ALTER TABLE "apl_item_workshop_prices" ADD COLUMN IF NOT EXISTS "stage_code" TEXT NOT NULL DEFAULT '';

ALTER TABLE "apl_item_workshop_prices" DROP CONSTRAINT IF EXISTS "apl_item_workshop_prices_import_id_item_team_code_key";
DROP INDEX IF EXISTS "apl_item_workshop_prices_import_id_item_team_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "apl_item_workshop_prices_import_id_item_team_code_stage_code_key"
  ON "apl_item_workshop_prices"("import_id", "item", "team_code", "stage_code");
