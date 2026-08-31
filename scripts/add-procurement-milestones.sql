CREATE TABLE IF NOT EXISTS "procurement_milestones" (
  "id" TEXT PRIMARY KEY, "bid_analysis_id" TEXT NOT NULL, "milestone_no" INTEGER NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL, "note" TEXT, "recorded_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "pm_bid_no_key" ON "procurement_milestones" ("bid_analysis_id","milestone_no");
CREATE INDEX IF NOT EXISTS "pm_bid_idx" ON "procurement_milestones" ("bid_analysis_id");
DO $$ BEGIN ALTER TABLE "procurement_milestones" ADD CONSTRAINT "pm_bid_fkey" FOREIGN KEY ("bid_analysis_id") REFERENCES "bid_analyses"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
