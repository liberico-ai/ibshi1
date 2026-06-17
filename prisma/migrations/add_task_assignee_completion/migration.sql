-- Hoàn thành theo từng người nhận + truy vết "chuyển tiếp"
ALTER TABLE "task_assignees" ADD COLUMN IF NOT EXISTS "done" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "task_assignees" ADD COLUMN IF NOT EXISTS "done_at" TIMESTAMP(3);
ALTER TABLE "task_assignees" ADD COLUMN IF NOT EXISTS "done_by" TEXT;
ALTER TABLE "task_assignees" ADD COLUMN IF NOT EXISTS "outcome" TEXT;

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "forwarded_from_id" TEXT;
CREATE INDEX IF NOT EXISTS "tasks_forwarded_from_id_idx" ON "tasks"("forwarded_from_id");
