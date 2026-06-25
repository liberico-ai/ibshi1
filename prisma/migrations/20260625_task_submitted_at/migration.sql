-- AlterTable: add submitted_at to tasks
ALTER TABLE "tasks" ADD COLUMN "submitted_at" TIMESTAMP(3);

-- Backfill: AWAITING_REVIEW tasks get submitted_at = updated_at
UPDATE "tasks" SET "submitted_at" = "updated_at" WHERE "status" = 'AWAITING_REVIEW' AND "submitted_at" IS NULL;
