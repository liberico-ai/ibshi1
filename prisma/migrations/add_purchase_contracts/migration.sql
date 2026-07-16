-- T1 — Hợp đồng mua (PurchaseContract)
-- Migration ADDITIVE + idempotent. KHÔNG reset (history prod≠local).

-- 1) Bảng hợp đồng mua
CREATE TABLE IF NOT EXISTS "purchase_contracts" (
    "id" TEXT NOT NULL,
    "contract_code" TEXT NOT NULL,
    "contract_type" TEXT NOT NULL DEFAULT 'HDMB',
    "project_id" TEXT,
    "vendor_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "signed_date" TIMESTAMP(3),
    "effective_date" TIMESTAMP(3),
    "payment_terms" TEXT,
    "delivery_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "signed_file_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_contracts_pkey" PRIMARY KEY ("id")
);

-- 2) Unique mã HĐ + index tra cứu
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_contracts_contract_code_key" ON "purchase_contracts"("contract_code");
CREATE INDEX IF NOT EXISTS "purchase_contracts_project_id_idx" ON "purchase_contracts"("project_id");
CREATE INDEX IF NOT EXISTS "purchase_contracts_vendor_id_idx" ON "purchase_contracts"("vendor_id");
CREATE INDEX IF NOT EXISTS "purchase_contracts_status_idx" ON "purchase_contracts"("status");

-- 3) FK HĐ → project / vendor (bọc idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_contracts_project_id_fkey') THEN
    ALTER TABLE "purchase_contracts" ADD CONSTRAINT "purchase_contracts_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_contracts_vendor_id_fkey') THEN
    ALTER TABLE "purchase_contracts" ADD CONSTRAINT "purchase_contracts_vendor_id_fkey"
      FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) PurchaseOrder.contract_id (cột mềm gắn HĐ, PO cũ vẫn hợp lệ)
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "contract_id" TEXT;
CREATE INDEX IF NOT EXISTS "purchase_orders_contract_id_idx" ON "purchase_orders"("contract_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_contract_id_fkey') THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "purchase_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
