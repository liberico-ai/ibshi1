-- PHIẾU đề nghị cấp vật tư + luồng duyệt PM → BGĐ.
-- ADDITIVE: thêm 1 bảng mới + 1 cột nullable; dữ liệu đang có được gom vào phiếu "đã duyệt"
-- để Kho cấp tiếp bình thường, không ai bị kẹt chờ duyệt vì thay đổi này.

-- 1. Bảng phiếu
CREATE TABLE IF NOT EXISTS "material_request_orders" (
  "id"              TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "project_id"      TEXT NOT NULL,
  "department_id"   TEXT,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "notes"           TEXT,
  "created_by"      TEXT NOT NULL,
  "submitted_at"    TIMESTAMP(3),
  "pm_approved_by"  TEXT,
  "pm_approved_at"  TIMESTAMP(3),
  "bod_approved_by" TEXT,
  "bod_approved_at" TIMESTAMP(3),
  "rejected_by"     TEXT,
  "rejected_at"     TIMESTAMP(3),
  "reject_reason"   TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_request_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "material_request_orders_code_key" ON "material_request_orders"("code");
CREATE INDEX IF NOT EXISTS "material_request_orders_project_id_idx" ON "material_request_orders"("project_id");
CREATE INDEX IF NOT EXISTS "material_request_orders_department_id_idx" ON "material_request_orders"("department_id");
CREATE INDEX IF NOT EXISTS "material_request_orders_status_idx" ON "material_request_orders"("status");

ALTER TABLE "material_request_orders"
  ADD CONSTRAINT "material_request_orders_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_request_orders"
  ADD CONSTRAINT "material_request_orders_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Dòng vật tư trỏ về phiếu
ALTER TABLE "work_order_material_requests" ADD COLUMN IF NOT EXISTS "request_id" TEXT;
CREATE INDEX IF NOT EXISTS "work_order_material_requests_request_id_idx" ON "work_order_material_requests"("request_id");

ALTER TABLE "work_order_material_requests"
  ADD CONSTRAINT "work_order_material_requests_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "material_request_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Gom dữ liệu cũ: mỗi (dự án × xưởng) một phiếu ĐÃ DUYỆT, gắn các dòng hiện có vào đó.
INSERT INTO "material_request_orders"
  ("id", "code", "project_id", "department_id", "status", "notes", "created_by",
   "submitted_at", "pm_approved_at", "bod_approved_at", "created_at", "updated_at")
SELECT
  'mrolegacy' || substr(md5(random()::text || COALESCE(w."project_id",'') || COALESCE(w."department_id",'')), 1, 16),
  'MR-CU-' || COALESCE(p."project_code", 'NA') || '-' || COALESCE(d."code", 'TP'),
  w."project_id", w."department_id", 'APPROVED',
  'Phiếu gom dữ liệu lập trước khi có bước duyệt', 'SYSTEM',
  NOW(), NOW(), NOW(), NOW(), NOW()
FROM "work_order_material_requests" r
JOIN "work_orders" w ON w."id" = r."work_order_id"
JOIN "projects"    p ON p."id" = w."project_id"
LEFT JOIN "departments" d ON d."id" = w."department_id"
WHERE r."request_id" IS NULL
GROUP BY w."project_id", w."department_id", p."project_code", d."code"
ON CONFLICT ("code") DO NOTHING;

UPDATE "work_order_material_requests" r
SET "request_id" = o."id"
FROM "work_orders" w
JOIN "material_request_orders" o
  ON o."project_id" = w."project_id"
 AND o."department_id" IS NOT DISTINCT FROM w."department_id"
 AND o."created_by" = 'SYSTEM'
WHERE r."work_order_id" = w."id" AND r."request_id" IS NULL;

-- 4. Khoá trùng chuyển từ (lệnh, vật tư) sang (phiếu, lệnh, vật tư) — đợt sau còn xin thêm được.
DROP INDEX IF EXISTS "work_order_material_requests_work_order_id_material_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_material_requests_request_id_work_order_id_mater_key"
  ON "work_order_material_requests"("request_id", "work_order_id", "material_id");
