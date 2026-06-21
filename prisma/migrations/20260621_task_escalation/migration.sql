-- AlterTable (additive only — safe for production)
ALTER TABLE "tasks" ADD COLUMN "escalated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "escalated_at" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "escalated_by" TEXT;

-- CreateIndex
CREATE INDEX "tasks_escalated_idx" ON "tasks"("escalated");
