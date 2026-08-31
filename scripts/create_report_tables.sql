-- ============================================================================
-- Module "Báo cáo quản trị" — 3 bảng cần tạo khi deploy (Danh mục BC + Ledger MISA)
-- An toàn chạy lại nhiều lần (IF NOT EXISTS + FK trong DO-block guard).
-- ============================================================================

-- 1) Danh mục báo cáo quản trị
CREATE TABLE IF NOT EXISTS "management_reports" (
  "id"          TEXT NOT NULL,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "department"  TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "owner"       TEXT,
  "data_source" TEXT,
  "recipient"   TEXT,
  "frequency"   TEXT,
  "note"        TEXT,
  "auto_key"    TEXT,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "management_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "management_reports_department_idx" ON "management_reports"("department");
CREATE INDEX IF NOT EXISTS "management_reports_frequency_idx"  ON "management_reports"("frequency");

-- 2) Lô nhập bảng kê kế toán (MISA) — tạo TRƯỚC ledger_entries (đích của FK)
CREATE TABLE IF NOT EXISTS "ledger_import_batches" (
  "id"           TEXT NOT NULL,
  "file_name"    TEXT NOT NULL,
  "note"         TEXT,
  "row_count"    INTEGER NOT NULL DEFAULT 0,
  "matched_rows" INTEGER NOT NULL DEFAULT 0,
  "total_debit"  DECIMAL(65,30) NOT NULL DEFAULT 0,
  "total_credit" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "imported_by"  TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_import_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ledger_import_batches_created_at_idx" ON "ledger_import_batches"("created_at");

-- 3) Bút toán từ bảng kê MISA (khớp cột "Vụ việc" → dự án)
CREATE TABLE IF NOT EXISTS "ledger_entries" (
  "id"             TEXT NOT NULL,
  "batch_id"       TEXT NOT NULL,
  "entry_date"     TIMESTAMP(3) NOT NULL,
  "doc_type"       TEXT,
  "doc_no"         TEXT,
  "partner_code"   TEXT,
  "partner_name"   TEXT,
  "description"    TEXT,
  "account"        TEXT NOT NULL,
  "contra_account" TEXT,
  "debit"          DECIMAL(65,30) NOT NULL DEFAULT 0,
  "credit"         DECIMAL(65,30) NOT NULL DEFAULT 0,
  "vu_viec"        TEXT,
  "project_id"     TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ledger_entries_batch_id_idx"   ON "ledger_entries"("batch_id");
CREATE INDEX IF NOT EXISTS "ledger_entries_project_id_idx" ON "ledger_entries"("project_id");
CREATE INDEX IF NOT EXISTS "ledger_entries_account_idx"    ON "ledger_entries"("account");
CREATE INDEX IF NOT EXISTS "ledger_entries_vu_viec_idx"    ON "ledger_entries"("vu_viec");

-- FK ledger_entries.batch_id → ledger_import_batches.id (ON DELETE CASCADE)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ledger_entries_batch_id_fkey') THEN
    ALTER TABLE "ledger_entries"
      ADD CONSTRAINT "ledger_entries_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "ledger_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
