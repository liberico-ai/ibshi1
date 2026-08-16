-- Đợt 3: link PO ↔ BID để truy vết + idempotent. Additive.
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "bid_analysis_id" TEXT;
DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_bid_analysis_id_fkey"
    FOREIGN KEY ("bid_analysis_id") REFERENCES "bid_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "purchase_orders_bid_analysis_id_idx" ON "purchase_orders"("bid_analysis_id");
