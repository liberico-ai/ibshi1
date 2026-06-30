-- C5: ECO 7 nguồn revise + ai chịu chi phí + NCR→ECO link
-- ADDITIVE only — không đổi cột/bảng hiện có

-- A. Thêm source + costBearer vào ECO
ALTER TABLE "engineering_change_orders" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "engineering_change_orders" ADD COLUMN IF NOT EXISTS "cost_bearer" TEXT;
ALTER TABLE "engineering_change_orders" ADD COLUMN IF NOT EXISTS "ncr_id" TEXT;

-- B. Backfill ECO cũ: source=DESIGN, costBearer=INTERNAL
UPDATE "engineering_change_orders" SET "source" = 'DESIGN' WHERE "source" IS NULL;
UPDATE "engineering_change_orders" SET "cost_bearer" = 'INTERNAL' WHERE "cost_bearer" IS NULL;

-- C. Index cho NCR link + source filter
CREATE INDEX IF NOT EXISTS "eco_source_idx" ON "engineering_change_orders" ("source");
CREATE INDEX IF NOT EXISTS "eco_ncr_id_idx" ON "engineering_change_orders" ("ncr_id");
