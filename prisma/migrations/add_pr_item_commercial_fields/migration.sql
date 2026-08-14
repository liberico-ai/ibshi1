-- Module 2 (PORT Thương Mại): bổ sung cấu trúc PrDetail vào purchase_request_items.
-- TẤT CẢ nullable / có default → ADDITIVE, an toàn, không ảnh hưởng dữ liệu & luồng hiện có.

ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "material_group_code"     TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "material_sub_group_code" TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "unit_weight"   DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "net_qty"       DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "net_weight"    DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "req_qty"       DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "req_weight"    DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "remain_qty"    DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "remain_weight" DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "to_buy_qty"    DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "to_buy_weight" DECIMAL DEFAULT 0;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "status_flag"   TEXT DEFAULT 'Chờ báo giá';
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "remarks"       TEXT;
