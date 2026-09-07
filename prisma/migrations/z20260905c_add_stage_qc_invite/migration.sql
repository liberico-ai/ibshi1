-- Mời nghiệm thu theo từng công đoạn, thay cho mời ở cấp lệnh.
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qc_invited_qty" DECIMAL(65,30);
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qc_invited_at" TIMESTAMP(3);
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qc_invited_by" TEXT;
