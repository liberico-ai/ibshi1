-- AlterTable: add workOrderId + pieceMark to inspections
ALTER TABLE "inspections" ADD COLUMN "work_order_id" TEXT;
ALTER TABLE "inspections" ADD COLUMN "piece_mark" TEXT;

-- AlterTable: add workOrderId + pieceMark to itp_checkpoints
ALTER TABLE "itp_checkpoints" ADD COLUMN "work_order_id" TEXT;
ALTER TABLE "itp_checkpoints" ADD COLUMN "piece_mark" TEXT;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itp_checkpoints" ADD CONSTRAINT "itp_checkpoints_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "inspections_work_order_id_idx" ON "inspections"("work_order_id");

-- CreateIndex
CREATE INDEX "itp_checkpoints_work_order_id_idx" ON "itp_checkpoints"("work_order_id");
