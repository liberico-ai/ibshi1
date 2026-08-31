-- B7: Duyệt điều kiện thanh toán hợp đồng (idempotent).
ALTER TABLE "purchase_contracts"
  ADD COLUMN IF NOT EXISTS "payment_terms_status" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "pt_finance_by" TEXT,
  ADD COLUMN IF NOT EXISTS "pt_finance_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pt_ktkt_by" TEXT,
  ADD COLUMN IF NOT EXISTS "pt_ktkt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pt_bod_by" TEXT,
  ADD COLUMN IF NOT EXISTS "pt_bod_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pt_reject_by" TEXT,
  ADD COLUMN IF NOT EXISTS "pt_reject_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pt_reject_reason" TEXT;
