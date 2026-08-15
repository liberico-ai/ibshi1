-- PORT Thương Mại — Đợt 1: cụm Đấu thầu/Báo giá (BidAnalysis).
-- 4 bảng MỚI hoàn toàn (additive) — dùng chung projects/vendors/purchase_request_items của ERP.
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS. FK inline trong CREATE TABLE.

CREATE TABLE IF NOT EXISTS "bid_analyses" (
    "id"                 TEXT NOT NULL,
    "project_id"         TEXT,
    "bid_code"           TEXT NOT NULL,
    "bid_code_proj"      TEXT,
    "bid_code_yymm"      TEXT,
    "bid_code_mat"       TEXT,
    "bid_code_seq"       INTEGER,
    "bid_code_variant"   TEXT,
    "bid_code_urgent"    BOOLEAN NOT NULL DEFAULT false,
    "subject"            TEXT,
    "bid_date"           TIMESTAMP(3),
    "status"             TEXT NOT NULL DEFAULT 'OPEN',
    "selection_mode"     TEXT NOT NULL DEFAULT 'PER_ITEM',
    "selected_vendor_id" TEXT,
    "source_task_id"     TEXT,
    "notes"              TEXT,
    "created_by"         TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bid_analyses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "bid_analyses_bid_code_key" ON "bid_analyses"("bid_code");
CREATE INDEX IF NOT EXISTS "bid_analyses_project_id_idx" ON "bid_analyses"("project_id");
CREATE INDEX IF NOT EXISTS "bid_analyses_bid_code_proj_bid_code_yymm_idx" ON "bid_analyses"("bid_code_proj","bid_code_yymm");

CREATE TABLE IF NOT EXISTS "bid_quote_vendors" (
    "id"           TEXT NOT NULL,
    "bid_id"       TEXT NOT NULL,
    "vendor_id"    TEXT,
    "vendor_name"  TEXT NOT NULL,
    "vendor_type"  TEXT NOT NULL DEFAULT 'DOMESTIC',
    "vendor_order" INTEGER NOT NULL DEFAULT 0,
    "currency"     TEXT NOT NULL DEFAULT 'VND',
    "total_quote"  DECIMAL(65,30) NOT NULL DEFAULT 0,
    "is_winner"    BOOLEAN NOT NULL DEFAULT false,
    "notes"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bid_quote_vendors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_quote_vendors_bid_id_fkey" FOREIGN KEY ("bid_id") REFERENCES "bid_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bid_quote_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "bid_quote_vendors_bid_id_idx" ON "bid_quote_vendors"("bid_id");

CREATE TABLE IF NOT EXISTS "bid_quote_items" (
    "id"                       TEXT NOT NULL,
    "bid_id"                   TEXT NOT NULL,
    "purchase_request_item_id" TEXT,
    "item_order"               INTEGER NOT NULL DEFAULT 0,
    "item_code"                TEXT,
    "item_name"                TEXT,
    "profile"                  TEXT,
    "grade"                    TEXT,
    "uom"                      TEXT,
    "qty_pr"                   DECIMAL(65,30) NOT NULL DEFAULT 0,
    "qty_to_buy"               DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estimate_unit_price"      DECIMAL(65,30) NOT NULL DEFAULT 0,
    "selected_vendor_name"     TEXT,
    "notes"                    TEXT,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bid_quote_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_quote_items_bid_id_fkey" FOREIGN KEY ("bid_id") REFERENCES "bid_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bid_quote_items_purchase_request_item_id_fkey" FOREIGN KEY ("purchase_request_item_id") REFERENCES "purchase_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "bid_quote_items_bid_id_idx" ON "bid_quote_items"("bid_id");

CREATE TABLE IF NOT EXISTS "bid_quote_offers" (
    "id"            TEXT NOT NULL,
    "item_id"       TEXT NOT NULL,
    "vendor_id"     TEXT NOT NULL,
    "unit_price"    DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total_price"   DECIMAL(65,30) NOT NULL DEFAULT 0,
    "scope"         TEXT,
    "delivery_term" TEXT,
    "remarks"       TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bid_quote_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_quote_offers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "bid_quote_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bid_quote_offers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "bid_quote_vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "bid_quote_offers_item_id_vendor_id_key" ON "bid_quote_offers"("item_id","vendor_id");
CREATE INDEX IF NOT EXISTS "bid_quote_offers_item_id_idx" ON "bid_quote_offers"("item_id");
CREATE INDEX IF NOT EXISTS "bid_quote_offers_vendor_id_idx" ON "bid_quote_offers"("vendor_id");
