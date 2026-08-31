-- #5: Rev PR (idempotent).
ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "doc_no" TEXT,
  ADD COLUMN IF NOT EXISTS "rev_no" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "purchase_request_revisions" (
  "id"             TEXT PRIMARY KEY,
  "pr_id"          TEXT NOT NULL,
  "rev_no"         INTEGER NOT NULL,
  "items_snapshot" JSONB NOT NULL,
  "line_count"     INTEGER NOT NULL DEFAULT 0,
  "note"           TEXT,
  "changed_by"     TEXT,
  "changed_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "prr_pr_rev_key" ON "purchase_request_revisions" ("pr_id","rev_no");
CREATE INDEX IF NOT EXISTS "prr_pr_idx" ON "purchase_request_revisions" ("pr_id");
DO $$ BEGIN
  ALTER TABLE "purchase_request_revisions" ADD CONSTRAINT "prr_pr_fkey"
    FOREIGN KEY ("pr_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
