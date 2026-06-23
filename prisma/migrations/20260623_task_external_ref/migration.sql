-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "external_ref" TEXT;
ALTER TABLE "tasks" ADD COLUMN "external_source" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_external_ref_key" ON "tasks"("external_ref");
