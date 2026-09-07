-- Một ITP cho cả lệnh, bên trong tách một dòng cho mỗi công đoạn.
-- Mỗi dòng mang khối lượng riêng và ký riêng.
ALTER TABLE "itp_checkpoints" ADD COLUMN IF NOT EXISTS "stage_id" TEXT;
ALTER TABLE "itp_checkpoints" ADD COLUMN IF NOT EXISTS "accepted_qty" DECIMAL(65,30);

CREATE INDEX IF NOT EXISTS "itp_checkpoints_stage_id_idx" ON "itp_checkpoints"("stage_id");

DO $$ BEGIN
  ALTER TABLE "itp_checkpoints" ADD CONSTRAINT "itp_checkpoints_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "work_order_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
