-- Add earnedQty to WorkOrder (tấn earned = QC đạt)
-- ADDITIVE, nullable, default 0, no-op backfill
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "earned_qty" DECIMAL DEFAULT 0;
