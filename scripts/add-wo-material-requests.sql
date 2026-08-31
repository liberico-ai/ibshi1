-- Fix drift: bảng work_order_material_requests bị thiếu trên DB → route WBS 500. Idempotent.
CREATE TABLE IF NOT EXISTS "work_order_material_requests" (
  "id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "material_id" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "unit" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_order_material_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_material_requests_wo_mat_key" ON "work_order_material_requests"("work_order_id","material_id");
CREATE INDEX IF NOT EXISTS "work_order_material_requests_wo_idx" ON "work_order_material_requests"("work_order_id");
CREATE INDEX IF NOT EXISTS "work_order_material_requests_mat_idx" ON "work_order_material_requests"("material_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='womr_wo_fkey') THEN
    ALTER TABLE "work_order_material_requests" ADD CONSTRAINT "womr_wo_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;
  END IF;
  IF to_regclass('"materials"') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='womr_mat_fkey') THEN
    ALTER TABLE "work_order_material_requests" ADD CONSTRAINT "womr_mat_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id");
  END IF;
END $$;
