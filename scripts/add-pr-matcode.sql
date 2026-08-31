ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "mat_code" TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "mat_code_source" TEXT;
