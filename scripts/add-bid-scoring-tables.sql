-- =====================================================================
-- 5 CHẾ ĐỘ CHỌN NCC (khớp Commerce): thêm cột chấm điểm + 2 bảng phụ trợ.
-- Idempotent. Chạy trên DB có sẵn bid_analyses / bid_quote_items.
-- =====================================================================

-- Cột thêm trên bid_analyses (chấm điểm + dấu vết duyệt)
ALTER TABLE "bid_analyses"    ADD COLUMN IF NOT EXISTS "weighting_criteria" JSONB;
ALTER TABLE "bid_analyses"    ADD COLUMN IF NOT EXISTS "approved_by"        TEXT;
ALTER TABLE "bid_analyses"    ADD COLUMN IF NOT EXISTS "approved_at"        TIMESTAMP(3);

-- Cột thêm trên bid_quote_items (dấu vết chọn NCC cấp dòng)
ALTER TABLE "bid_quote_items" ADD COLUMN IF NOT EXISTS "selected_at"        TIMESTAMP(3);
ALTER TABLE "bid_quote_items" ADD COLUMN IF NOT EXISTS "selected_by"        TEXT;

CREATE INDEX IF NOT EXISTS "bid_analyses_selection_mode_idx" ON "bid_analyses"("selection_mode");

-- PER_GROUP — mỗi nhóm vật tư 1 NCC
CREATE TABLE IF NOT EXISTS "bid_group_selections" (
  "id"                      TEXT NOT NULL,
  "bid_analysis_id"         TEXT NOT NULL,
  "material_sub_group_code" TEXT NOT NULL,
  "selected_vendor_name"    TEXT NOT NULL,
  "selected_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "selected_by"             TEXT,
  "notes"                   TEXT,
  CONSTRAINT "bid_group_selections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bid_group_selections_bid_group_key" ON "bid_group_selections"("bid_analysis_id","material_sub_group_code");
CREATE INDEX IF NOT EXISTS "bid_group_selections_bid_analysis_id_idx" ON "bid_group_selections"("bid_analysis_id");

-- MANUAL_WEIGHTED — chấm điểm từng NCC
CREATE TABLE IF NOT EXISTS "bid_vendor_scores" (
  "id"              TEXT NOT NULL,
  "bid_analysis_id" TEXT NOT NULL,
  "vendor_name"     TEXT NOT NULL,
  "price_score"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "quality_score"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payment_score"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "overall_score"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scored_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scored_by"       TEXT,
  "notes"           TEXT,
  CONSTRAINT "bid_vendor_scores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bid_vendor_scores_bid_vendor_key" ON "bid_vendor_scores"("bid_analysis_id","vendor_name");
CREATE INDEX IF NOT EXISTS "bid_vendor_scores_bid_analysis_id_idx" ON "bid_vendor_scores"("bid_analysis_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bid_group_selections_bid_fkey') THEN
    ALTER TABLE "bid_group_selections" ADD CONSTRAINT "bid_group_selections_bid_fkey" FOREIGN KEY ("bid_analysis_id") REFERENCES "bid_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bid_vendor_scores_bid_fkey') THEN
    ALTER TABLE "bid_vendor_scores" ADD CONSTRAINT "bid_vendor_scores_bid_fkey" FOREIGN KEY ("bid_analysis_id") REFERENCES "bid_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
