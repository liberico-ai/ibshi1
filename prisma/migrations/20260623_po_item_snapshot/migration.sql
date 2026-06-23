-- AlterTable: PurchaseOrder — add sourceTaskId
ALTER TABLE "purchase_orders" ADD COLUMN "source_task_id" TEXT;

-- AlterTable: PurchaseOrderItem — materialId optional + snapshot fields
ALTER TABLE "purchase_order_items" ALTER COLUMN "material_id" DROP NOT NULL;
ALTER TABLE "purchase_order_items" ADD COLUMN "item_code" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "item_description" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "item_profile" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "item_grade" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "item_unit" TEXT;
