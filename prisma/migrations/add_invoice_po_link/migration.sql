-- Invoice ↔ PurchaseOrder link (nullable FK)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "po_id" TEXT;
CREATE INDEX IF NOT EXISTS "invoices_po_id_idx" ON "invoices"("po_id");
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_po_id_fkey";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_po_id_fkey"
  FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
