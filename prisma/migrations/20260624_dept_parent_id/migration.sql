-- AlterTable: add parent_id to departments for hierarchy (TO-* are children of SX)
ALTER TABLE "departments" ADD COLUMN "parent_id" TEXT;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");
