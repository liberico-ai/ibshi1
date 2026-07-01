-- Add wpsCertId column + FK indexes for weld cert linkage
-- ADDITIVE, nullable, tables empty on prod

-- 1. New column
ALTER TABLE "weld_joints" ADD COLUMN IF NOT EXISTS "wps_cert_id" TEXT;

-- 2. Indexes (welder_cert_id index was missing from original migration)
CREATE INDEX IF NOT EXISTS "weld_joints_welder_cert_id_idx" ON "weld_joints"("welder_cert_id");
CREATE INDEX IF NOT EXISTS "weld_joints_wps_cert_id_idx" ON "weld_joints"("wps_cert_id");

-- 3. FK constraints to certificate_registry
ALTER TABLE "weld_joints"
  ADD CONSTRAINT "weld_joints_welder_cert_id_fkey"
  FOREIGN KEY ("welder_cert_id") REFERENCES "certificate_registry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "weld_joints"
  ADD CONSTRAINT "weld_joints_wps_cert_id_fkey"
  FOREIGN KEY ("wps_cert_id") REFERENCES "certificate_registry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
