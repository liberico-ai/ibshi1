-- TRIR/LTIFR support: recordable flag + man-hours table
-- ADDITIVE, no destructive changes

-- 1. SafetyIncident: add recordable flag (existing data defaults to false)
ALTER TABLE "safety_incidents" ADD COLUMN IF NOT EXISTS "recordable" BOOLEAN NOT NULL DEFAULT false;

-- 2. New table: hse_man_hours
CREATE TABLE IF NOT EXISTS "hse_man_hours" (
  "id" TEXT NOT NULL,
  "period_year" INTEGER NOT NULL,
  "period_month" INTEGER NOT NULL,
  "project_id" TEXT,
  "man_hours" DECIMAL NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "note" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hse_man_hours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hse_man_hours_period_year_period_month_project_id_key"
  ON "hse_man_hours"("period_year", "period_month", "project_id");

CREATE INDEX IF NOT EXISTS "hse_man_hours_project_id_idx" ON "hse_man_hours"("project_id");

ALTER TABLE "hse_man_hours"
  ADD CONSTRAINT "hse_man_hours_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
