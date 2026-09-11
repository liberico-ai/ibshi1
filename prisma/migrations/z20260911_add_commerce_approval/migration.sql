-- Đợt báo giá Thương mại trình BGĐ duyệt trong ERP.
-- Bản gương từ ibs-commerce: ERP chỉ ghi quyết định (status/decided_by/decided_at/reason).

CREATE TABLE IF NOT EXISTS "commerce_approvals" (
  "id"               TEXT PRIMARY KEY,
  "remote_id"        TEXT NOT NULL,
  "bid_code"         TEXT NOT NULL,
  "ref_project_code" TEXT NOT NULL,
  "project_id"       TEXT,
  "subject"          TEXT NOT NULL,
  "selection_mode"   TEXT,
  "currency"         TEXT NOT NULL DEFAULT 'VND',
  "total_value"      DECIMAL(65,30) NOT NULL DEFAULT 0,
  "file_url"         TEXT,
  "snapshot"         JSONB,
  "submitted_by"     TEXT,
  "submitted_at"     TIMESTAMP(3) NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'PENDING',
  "decided_by"       TEXT,
  "decided_at"       TIMESTAMP(3),
  "reason"           TEXT,
  "notified_at"      TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "commerce_approvals_remote_id_key"        ON "commerce_approvals"("remote_id");
CREATE INDEX IF NOT EXISTS "commerce_approvals_status_submitted_at_idx"     ON "commerce_approvals"("status","submitted_at");
CREATE INDEX IF NOT EXISTS "commerce_approvals_project_id_idx"              ON "commerce_approvals"("project_id");

DO $$ BEGIN
  ALTER TABLE "commerce_approvals"
    ADD CONSTRAINT "commerce_approvals_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "commerce_approval_lines" (
  "id"             TEXT PRIMARY KEY,
  "approval_id"    TEXT NOT NULL,
  "line_no"        INTEGER NOT NULL,
  "item_code"      TEXT NOT NULL DEFAULT '',
  "item_name"      TEXT NOT NULL DEFAULT '',
  "profile"        TEXT,
  "grade"          TEXT,
  "uom"            TEXT NOT NULL DEFAULT '',
  "quantity"       DECIMAL(65,30) NOT NULL DEFAULT 0,
  "vendor_name"    TEXT,
  "unit_price"     DECIMAL(65,30) NOT NULL DEFAULT 0,
  "total_price"    DECIMAL(65,30) NOT NULL DEFAULT 0,
  "est_unit_price" DECIMAL(65,30),
  "offers"         JSONB,
  "notes"          TEXT
);
CREATE INDEX IF NOT EXISTS "commerce_approval_lines_approval_id_idx" ON "commerce_approval_lines"("approval_id");

DO $$ BEGIN
  ALTER TABLE "commerce_approval_lines"
    ADD CONSTRAINT "commerce_approval_lines_approval_id_fkey"
    FOREIGN KEY ("approval_id") REFERENCES "commerce_approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
