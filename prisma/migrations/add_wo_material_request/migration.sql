-- Vật tư ĐỀ NGHỊ CẤP theo lệnh sản xuất (WO).
-- ADDITIVE: bảng mới, không sửa/xoá bảng nào đang có → an toàn chạy trên DB đang chạy.
-- Kho tính "còn thiếu" = tổng quantity ở bảng này − tổng đã cấp ở material_issues (cùng WO + vật tư).

CREATE TABLE IF NOT EXISTS "work_order_material_requests" (
  "id"            TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "material_id"   TEXT NOT NULL,
  "quantity"      DECIMAL(65,30) NOT NULL,
  "unit"          TEXT NOT NULL,
  "source"        TEXT NOT NULL DEFAULT 'MANUAL',
  "notes"         TEXT,
  "created_by"    TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_order_material_requests_pkey" PRIMARY KEY ("id")
);

-- Mỗi WO chỉ có 1 dòng cho mỗi mã vật tư (sửa số lượng thay vì thêm dòng trùng)
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_material_requests_work_order_id_material_id_key"
  ON "work_order_material_requests"("work_order_id", "material_id");
CREATE INDEX IF NOT EXISTS "work_order_material_requests_work_order_id_idx"
  ON "work_order_material_requests"("work_order_id");
CREATE INDEX IF NOT EXISTS "work_order_material_requests_material_id_idx"
  ON "work_order_material_requests"("material_id");

-- Xoá WO thì xoá luôn đề nghị của nó (ô WBS bỏ xưởng → WO bị xoá ở from-wbs-cell)
ALTER TABLE "work_order_material_requests"
  ADD CONSTRAINT "work_order_material_requests_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_material_requests"
  ADD CONSTRAINT "work_order_material_requests_material_id_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
