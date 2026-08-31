-- Hard Pegging: giữ cứng tồn kho theo nhu cầu PR (idempotent).
CREATE TABLE IF NOT EXISTS "hard_peggings" (
  "id"           TEXT PRIMARY KEY,
  "pr_item_id"   TEXT NOT NULL,
  "material_id"  TEXT NOT NULL,
  "project_id"   TEXT,
  "quantity"     DECIMAL NOT NULL DEFAULT 0,
  "status"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "note"         TEXT,
  "allocated_by" TEXT NOT NULL,
  "allocated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_by"  TEXT,
  "released_at"  TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "hard_peggings_pr_item_id_key" ON "hard_peggings" ("pr_item_id");
CREATE INDEX IF NOT EXISTS "hard_peggings_material_id_idx" ON "hard_peggings" ("material_id");
CREATE INDEX IF NOT EXISTS "hard_peggings_project_id_idx" ON "hard_peggings" ("project_id");
CREATE INDEX IF NOT EXISTS "hard_peggings_status_idx" ON "hard_peggings" ("status");

DO $$ BEGIN
  ALTER TABLE "hard_peggings" ADD CONSTRAINT "hard_peggings_pr_item_id_fkey"
    FOREIGN KEY ("pr_item_id") REFERENCES "purchase_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hard_peggings" ADD CONSTRAINT "hard_peggings_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hard_peggings" ADD CONSTRAINT "hard_peggings_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
