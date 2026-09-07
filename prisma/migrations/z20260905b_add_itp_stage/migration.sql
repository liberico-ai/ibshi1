-- Đợt nghiệm thu gắn với MỘT công đoạn của lệnh.
-- NULL = lệnh chạy nguyên khối, hoặc đợt lập trước khi có công đoạn.
ALTER TABLE "inspection_test_plans" ADD COLUMN IF NOT EXISTS "stage_id" TEXT;

CREATE INDEX IF NOT EXISTS "inspection_test_plans_stage_id_idx" ON "inspection_test_plans"("stage_id");

-- Xoá công đoạn thì đợt nghiệm thu vẫn còn (chữ ký là dữ liệu thật), chỉ mất liên kết.
DO $$ BEGIN
  ALTER TABLE "inspection_test_plans" ADD CONSTRAINT "inspection_test_plans_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "work_order_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
