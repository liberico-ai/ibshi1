-- AlterTable: add taskId to non_conformance_reports
ALTER TABLE "non_conformance_reports" ADD COLUMN "task_id" TEXT;

-- AlterTable: add taskId to work_permits
ALTER TABLE "work_permits" ADD COLUMN "task_id" TEXT;

-- CreateIndex
CREATE INDEX "non_conformance_reports_task_id_idx" ON "non_conformance_reports"("task_id");

-- CreateIndex
CREATE INDEX "work_permits_task_id_idx" ON "work_permits"("task_id");
