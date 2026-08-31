-- Bảng đơn giá khoán theo dòng APL (KTKH nhập ở bước P5.5).
CREATE TABLE IF NOT EXISTS "apl_line_prices" (
  "id"          TEXT NOT NULL,
  "import_id"   TEXT NOT NULL,
  "apl_line_id" TEXT NOT NULL,
  "unit_price"  DECIMAL(65,30) NOT NULL,
  "note"        TEXT,
  "updated_by"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "apl_line_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "apl_line_prices_apl_line_id_key" ON "apl_line_prices"("apl_line_id");
CREATE INDEX IF NOT EXISTS "apl_line_prices_import_id_idx" ON "apl_line_prices"("import_id");

-- Đầu bảng giá: lưu dở (DRAFT) rồi chốt (COMPLETED).
CREATE TABLE IF NOT EXISTS "apl_pricings" (
  "id"           TEXT NOT NULL,
  "import_id"    TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'DRAFT',
  "total_amount" DECIMAL(65,30),
  "completed_by" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "apl_pricings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "apl_pricings_import_id_key" ON "apl_pricings"("import_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apl_line_prices_import_id_fkey') THEN
    ALTER TABLE "apl_line_prices" ADD CONSTRAINT "apl_line_prices_import_id_fkey"
      FOREIGN KEY ("import_id") REFERENCES "apl_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apl_line_prices_apl_line_id_fkey') THEN
    ALTER TABLE "apl_line_prices" ADD CONSTRAINT "apl_line_prices_apl_line_id_fkey"
      FOREIGN KEY ("apl_line_id") REFERENCES "apl_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apl_pricings_import_id_fkey') THEN
    ALTER TABLE "apl_pricings" ADD CONSTRAINT "apl_pricings_import_id_fkey"
      FOREIGN KEY ("import_id") REFERENCES "apl_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
