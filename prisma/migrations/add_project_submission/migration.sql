-- ADDITIVE: new table project_submissions + nullable column projects.sale_customer_id

CREATE TABLE IF NOT EXISTS "project_submissions" (
  "id"               TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "external_ref"     TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'UNDER_REVIEW',
  "payload"          JSONB NOT NULL DEFAULT '{}',
  "sale_customer_id" TEXT,
  "project_id"       TEXT,
  "project_code"     TEXT,
  "reason"           TEXT,
  "reviewed_by"      TEXT,
  "reviewed_at"      TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_submissions_external_ref_key" UNIQUE ("external_ref"),
  CONSTRAINT "project_submissions_project_id_key" UNIQUE ("project_id")
);

CREATE INDEX IF NOT EXISTS "project_submissions_status_idx" ON "project_submissions"("status");

-- Nullable FK to projects (set after reviewer approve)
ALTER TABLE "project_submissions"
  ADD CONSTRAINT "project_submissions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add saleCustomerId to projects (nullable, no data change)
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sale_customer_id" TEXT;
CREATE INDEX IF NOT EXISTS "projects_sale_customer_id_idx" ON "projects"("sale_customer_id");
