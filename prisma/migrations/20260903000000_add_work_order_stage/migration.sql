-- Công đoạn bên trong một lệnh sản xuất.
-- Xưởng Hoàn thiện nhận 71.504 kg thì tách "Sơn lớp 1" 10.240 kg và "Sơn lớp 2" 46.123 kg.
-- Tổng khối lượng các công đoạn không được vượt khối lượng của lệnh.
CREATE TABLE IF NOT EXISTS "work_order_stages" (
  "id"            TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "qty"           DECIMAL(65,30) NOT NULL,
  "unit"          TEXT NOT NULL DEFAULT 'kg',
  "sort_order"    INTEGER NOT NULL DEFAULT 0,
  "note"          TEXT,
  "created_by"    TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_order_stages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_order_stages_work_order_id_idx"
  ON "work_order_stages" ("work_order_id");

DO $$ BEGIN
  ALTER TABLE "work_order_stages"
    ADD CONSTRAINT "work_order_stages_work_order_id_fkey"
    FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
