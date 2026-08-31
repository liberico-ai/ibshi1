-- WO sinh từ APL: lưu TÊN VẬT TƯ và liên kết ngược về dòng cụm APL.
--   materials  : gom từ các dòng chi tiết ("SS400, A307") — lưu thẳng để hiển thị nhanh và
--                KHÔNG mất khi bản APL bị xoá.
--   apl_line_id: truy ngược về đúng dòng cụm; APL bị xoá thì đặt NULL, không xoá WO.
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "materials"   TEXT;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "apl_line_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_apl_line_id_fkey"
    FOREIGN KEY ("apl_line_id") REFERENCES "apl_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "work_orders_apl_line_id_idx" ON "work_orders"("apl_line_id");

-- Vá WO đã tạo trước đó: tách phần "· VT: ..." đang nhét trong mô tả ra cột riêng,
-- rồi trả mô tả về đúng nội dung của nó.
UPDATE "work_orders"
SET "materials"  = NULLIF(TRIM(SUBSTRING("description" FROM '· VT: (.*)$')), ''),
    "description" = TRIM(REGEXP_REPLACE("description", ' · VT: .*$', ''))
WHERE "description" LIKE '%· VT: %';
