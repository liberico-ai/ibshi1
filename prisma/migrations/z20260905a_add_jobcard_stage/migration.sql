-- Phiếu công việc gắn với MỘT công đoạn của lệnh.
-- Lệnh có khai công đoạn thì xưởng báo theo từng công đoạn; NULL = phiếu cũ / lệnh nguyên khối.
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "stage_id" TEXT;

CREATE INDEX IF NOT EXISTS "job_cards_stage_id_idx" ON "job_cards"("stage_id");

-- Xoá công đoạn thì phiếu vẫn còn (khối lượng đã báo là dữ liệu thật), chỉ mất liên kết.
DO $$ BEGIN
  ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "work_order_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
