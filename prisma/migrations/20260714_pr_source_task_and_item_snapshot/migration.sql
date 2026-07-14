-- Nối luồng Task → PurchaseRequest (bước 2/5 — chỉ ADDITIVE, chưa bật gì).
--
-- An toàn: purchase_requests = 0 dòng, purchase_request_items = 0 dòng (prod 14/07/2026)
-- ⟹ không có dữ liệu cũ để vỡ. Mọi câu lệnh idempotent (chạy lại được).
--
-- Vì sao phải nới material_id nullable + thêm snapshot:
--   1307/3017 dòng nhu cầu mua thật (nằm trong Task.resultData) CHƯA khớp mã vật tư
--   (materialId = null); vật tư tiêu hao như "dây hàn E71T-1C" chưa có bản ghi Material.
--   purchase_order_items đã giải đúng bài này từ trước — ở đây sao y.

-- ── PurchaseRequest: truy vết task nguồn (UNIQUE ⟹ materialize idempotent) ──
ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "source_task_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requests_source_task_id_key"
  ON "purchase_requests" ("source_task_id");

-- ── PurchaseRequestItem: nới FK + snapshot field (sao y purchase_order_items) ──
ALTER TABLE "purchase_request_items" ALTER COLUMN "material_id" DROP NOT NULL;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "item_code"        TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "item_description" TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "item_profile"     TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "item_grade"       TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "item_unit"        TEXT;
