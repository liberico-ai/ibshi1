-- ITP lập cho MỘT lệnh sản xuất đã báo xong khối lượng.
-- Dữ liệu ITP cũ không có WO → để NULL, không ảnh hưởng.
ALTER TABLE "inspection_test_plans"
  ADD COLUMN IF NOT EXISTS "work_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "inspection_date" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "inspection_test_plans_work_order_id_idx"
  ON "inspection_test_plans"("work_order_id");

-- Xóa WO thì ITP vẫn còn, chỉ mất liên kết (SetNull) — không mất hồ sơ kiểm tra.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inspection_test_plans_work_order_id_fkey'
  ) THEN
    ALTER TABLE "inspection_test_plans"
      ADD CONSTRAINT "inspection_test_plans_work_order_id_fkey"
      FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
