-- BomItem.layer: phân lớp vật tư (HARD=chính, NORM=định mức, STOCK=tồn kho)
-- ADDITIVE, nullable, backfill theo category hiện có
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "layer" TEXT;

-- Backfill: MAIN→HARD, WELD/PAINT→NORM, AUX/CONSUMABLE→STOCK
UPDATE "bom_items" SET "layer" = CASE
  WHEN category = 'MAIN' THEN 'HARD'
  WHEN category IN ('WELD', 'PAINT') THEN 'NORM'
  WHEN category IN ('AUX', 'CONSUMABLE') THEN 'STOCK'
  ELSE 'HARD'
END
WHERE "layer" IS NULL;

-- Seed sample norms (IBS standard rates for structural steel fabrication)
-- Only insert if norms table is empty
INSERT INTO "norms" (id, category, code, name, unit, rate, basis_unit, notes, created_at, updated_at)
SELECT * FROM (VALUES
  (gen_random_uuid()::text, 'WELD', 'NORM-WELD-QUE', 'Que hàn (E7018)', 'kg', 20.0, 'ton', 'Tiêu chuẩn 20kg que hàn/tấn thép', now(), now()),
  (gen_random_uuid()::text, 'WELD', 'NORM-WELD-DAY', 'Dây hàn CO2 (ER70S-6)', 'kg', 15.0, 'ton', 'Tiêu chuẩn 15kg dây hàn/tấn thép', now(), now()),
  (gen_random_uuid()::text, 'WELD', 'NORM-WELD-OXY', 'Oxy công nghiệp', 'chai', 8.0, 'ton', 'Tiêu chuẩn 8 chai/tấn thép', now(), now()),
  (gen_random_uuid()::text, 'WELD', 'NORM-WELD-GAS', 'Khí CO2', 'kg', 25.0, 'ton', 'Tiêu chuẩn 25kg CO2/tấn thép', now(), now()),
  (gen_random_uuid()::text, 'PAINT', 'NORM-PAINT-LOT', 'Sơn lót (epoxy)', 'lít', 5.0, 'ton', '~35m²/tấn × 0.15 lít/m² = 5 lít/tấn', now(), now()),
  (gen_random_uuid()::text, 'PAINT', 'NORM-PAINT-PHU', 'Sơn phủ (PU)', 'lít', 4.0, 'ton', '~35m²/tấn × 0.12 lít/m² = 4 lít/tấn', now(), now()),
  (gen_random_uuid()::text, 'PAINT', 'NORM-PAINT-DUNG', 'Dung môi pha sơn', 'lít', 2.0, 'ton', 'Tiêu chuẩn 2 lít/tấn', now(), now()),
  (gen_random_uuid()::text, 'CONSUMABLE', 'NORM-CONS-DA', 'Đá mài (125mm)', 'viên', 4.0, 'ton', 'Tiêu chuẩn 4 viên/tấn', now(), now()),
  (gen_random_uuid()::text, 'CONSUMABLE', 'NORM-CONS-DACAT', 'Đá cắt (355mm)', 'viên', 2.0, 'ton', 'Tiêu chuẩn 2 viên/tấn', now(), now()),
  (gen_random_uuid()::text, 'CONSUMABLE', 'NORM-CONS-MUI', 'Mũi khoan', 'cái', 1.0, 'ton', 'Tiêu chuẩn 1 cái/tấn', now(), now())
) AS t(id, category, code, name, unit, rate, basis_unit, notes, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM "norms" LIMIT 1);
