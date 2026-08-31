-- #5 MTC trên hợp đồng
ALTER TABLE "purchase_contracts"
  ADD COLUMN IF NOT EXISTS "mtc_status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "mtc_accepted_by" TEXT,
  ADD COLUMN IF NOT EXISTS "mtc_accepted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mtc_reject_reason" TEXT;

-- #4 Phiếu nhận hàng QT25
CREATE TABLE IF NOT EXISTS "goods_receipts" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "contract_id" TEXT, "project_id" TEXT, "vendor_name" TEXT,
  "arrived_date" TIMESTAMP(3), "received_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "received_by" TEXT NOT NULL,
  "packing_checked" BOOLEAN NOT NULL DEFAULT false, "qty_checked" BOOLEAN NOT NULL DEFAULT false,
  "has_damage" BOOLEAN NOT NULL DEFAULT false, "damage_hold" BOOLEAN NOT NULL DEFAULT false, "damage_note" TEXT,
  "tagged" BOOLEAN NOT NULL DEFAULT false, "notified_prod" BOOLEAN NOT NULL DEFAULT false,
  "sla_deadline" TIMESTAMP(3), "within_sla" BOOLEAN, "status" TEXT NOT NULL DEFAULT 'DRAFT', "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "goods_receipts_contract_idx" ON "goods_receipts" ("contract_id");
CREATE INDEX IF NOT EXISTS "goods_receipts_project_idx" ON "goods_receipts" ("project_id");
DO $$ BEGIN ALTER TABLE "goods_receipts" ADD CONSTRAINT "gr_contract_fkey" FOREIGN KEY ("contract_id") REFERENCES "purchase_contracts"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "goods_receipts" ADD CONSTRAINT "gr_project_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
