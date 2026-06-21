-- AlterTable: add blocked flag to tasks
ALTER TABLE "tasks" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tasks_status_blocked_idx" ON "tasks"("status", "blocked");
