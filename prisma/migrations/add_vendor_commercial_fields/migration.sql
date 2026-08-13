-- Module 1 (PORT Thương Mại): bổ sung hồ sơ NCC vào bảng vendors.
-- TẤT CẢ nullable / có default → ADDITIVE, an toàn, không ảnh hưởng dữ liệu & quan hệ hiện có.

ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "short_name"     TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "tax_code"       TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "city"           TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "website"        TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "contact_title"  TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "contact_phone"  TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "contact_email"  TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "vendor_type"    TEXT DEFAULT 'DOMESTIC';
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "bank"           TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "account_no"     TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "blacklisted"    BOOLEAN NOT NULL DEFAULT false;
