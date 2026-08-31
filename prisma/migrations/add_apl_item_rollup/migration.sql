-- APL: cột ITEM thành cột chính thức + phần cộng gộp theo KHỐI (dòng vàng).
-- Trước đó ITEM nằm trong extra (JSON) nên không lập chỉ mục / group by hiệu quả được,
-- mà màn "Tạo WO từ APL" lại phải liệt kê ITEM của cả dự án.

ALTER TABLE "apl_lines" ADD COLUMN IF NOT EXISTS "item"              TEXT;
ALTER TABLE "apl_lines" ADD COLUMN IF NOT EXISTS "block_no"          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "apl_lines" ADD COLUMN IF NOT EXISTS "rollup_weight_kg"  DOUBLE PRECISION;
ALTER TABLE "apl_lines" ADD COLUMN IF NOT EXISTS "rollup_materials"  JSONB;
ALTER TABLE "apl_lines" ADD COLUMN IF NOT EXISTS "child_count"       INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "apl_lines_import_id_item_idx"             ON "apl_lines"("import_id", "item");
CREATE INDEX IF NOT EXISTS "apl_lines_import_id_is_assembly_item_idx" ON "apl_lines"("import_id", "is_assembly", "item");
