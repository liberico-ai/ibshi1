-- Đợt 3 khối 1: hợp đồng chi tiết (line items + QC + mốc nhập khẩu). Idempotent.
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "trade_type" TEXT;
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "vendor_country" TEXT;
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "export_port" TEXT;
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "import_lc_date" TIMESTAMP(3);
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "cif_date" TIMESTAMP(3);
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "payment_date" TIMESTAMP(3);
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "customs_date" TIMESTAMP(3);
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "arrived_date" TIMESTAMP(3);
ALTER TABLE "purchase_contracts" ADD COLUMN IF NOT EXISTS "qc_invitation_date" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "purchase_contract_items" (
  "id" TEXT NOT NULL, "contract_id" TEXT NOT NULL, "pr_item_id" TEXT, "material_id" TEXT,
  "item_code" TEXT, "description" TEXT, "unit" TEXT, "actual_profile" TEXT, "actual_grade" TEXT,
  "contract_qty" DECIMAL(65,30) NOT NULL DEFAULT 0, "contract_weight" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "unit_price_no_vat" DECIMAL(65,30) NOT NULL DEFAULT 0, "currency" TEXT NOT NULL DEFAULT 'VND',
  "vat_rate" DECIMAL(65,30) NOT NULL DEFAULT 10, "total_no_vat" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "total_with_vat" DECIMAL(65,30) NOT NULL DEFAULT 0, "delivered_qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "delivered_weight" DECIMAL(65,30) NOT NULL DEFAULT 0, "handover_date" TIMESTAMP(3),
  "line_status" TEXT NOT NULL DEFAULT 'PENDING', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_contract_items_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "purchase_contract_items_contract_id_idx" ON "purchase_contract_items"("contract_id");
CREATE INDEX IF NOT EXISTS "purchase_contract_items_pr_item_id_idx" ON "purchase_contract_items"("pr_item_id");

CREATE TABLE IF NOT EXISTS "contract_inspections" (
  "id" TEXT NOT NULL, "contract_item_id" TEXT NOT NULL, "inspection_type" TEXT NOT NULL DEFAULT 'DOMESTIC',
  "report_no" TEXT, "inspection_date" TIMESTAMP(3), "inspected_qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "inspected_weight" DECIMAL(65,30) NOT NULL DEFAULT 0, "accepted_qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "accepted_weight" DECIMAL(65,30) NOT NULL DEFAULT 0, "result" TEXT, "remarks" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_inspections_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "contract_inspections_contract_item_id_idx" ON "contract_inspections"("contract_item_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_contract_items_contract_fkey') THEN
    ALTER TABLE "purchase_contract_items" ADD CONSTRAINT "purchase_contract_items_contract_fkey" FOREIGN KEY ("contract_id") REFERENCES "purchase_contracts"("id") ON DELETE CASCADE;
  END IF;
  IF to_regclass('"purchase_request_items"') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_contract_items_pritem_fkey') THEN
    ALTER TABLE "purchase_contract_items" ADD CONSTRAINT "purchase_contract_items_pritem_fkey" FOREIGN KEY ("pr_item_id") REFERENCES "purchase_request_items"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contract_inspections_item_fkey') THEN
    ALTER TABLE "contract_inspections" ADD CONSTRAINT "contract_inspections_item_fkey" FOREIGN KEY ("contract_item_id") REFERENCES "purchase_contract_items"("id") ON DELETE CASCADE;
  END IF;
END $$;
