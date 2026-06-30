-- AlterTable: add warehouseId to StockMovement (nullable, FK to Warehouse)
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_movements_warehouse_id_idx" ON "stock_movements"("warehouse_id");

-- AddForeignKey (idempotent: drop if exists first)
ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_warehouse_id_fkey";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
