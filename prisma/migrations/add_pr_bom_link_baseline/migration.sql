-- C3: Chuẩn hóa mắt xích PR↔BOM + Tách Baseline đông cứng
-- ADDITIVE only — không đổi logic hiện tại

-- A. PR item ↔ BOM link (nullable — backward compatible)
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "bom_item_id" TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "bom_version_id" TEXT;
CREATE INDEX IF NOT EXISTS "pri_bom_item_id_idx" ON "purchase_request_items" ("bom_item_id");
CREATE INDEX IF NOT EXISTS "pri_bom_version_id_idx" ON "purchase_request_items" ("bom_version_id");

-- B. Budget ↔ bomVersionId (nullable)
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "bom_version_id" TEXT;

-- C. ProjectBaseline — snapshot dự toán Rev.0 đông cứng
CREATE TABLE IF NOT EXISTS "project_baselines" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "project_id" TEXT NOT NULL,
  "version" INT NOT NULL DEFAULT 0,
  "label" TEXT NOT NULL DEFAULT 'Rev.0',
  "frozen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "frozen_by" TEXT,
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "baseline_project_version_idx" ON "project_baselines" ("project_id", "version");
CREATE INDEX IF NOT EXISTS "baseline_project_idx" ON "project_baselines" ("project_id");
