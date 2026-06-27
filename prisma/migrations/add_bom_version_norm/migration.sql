-- CreateTable: bom_versions
CREATE TABLE "bom_versions" (
    "id" TEXT NOT NULL,
    "bom_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source_revision_id" TEXT,
    "eco_id" TEXT,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bom_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: norms (định mức hàn/sơn/tiêu hao)
CREATE TABLE "norms" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "basis_unit" TEXT NOT NULL,
    "material_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "norms_pkey" PRIMARY KEY ("id")
);

-- AlterTable: bom_items — add version link + category + pieceMark + profile + grade
ALTER TABLE "bom_items" ADD COLUMN "bom_version_id" TEXT;
ALTER TABLE "bom_items" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'MAIN';
ALTER TABLE "bom_items" ADD COLUMN "piece_mark" TEXT;
ALTER TABLE "bom_items" ADD COLUMN "profile" TEXT;
ALTER TABLE "bom_items" ADD COLUMN "grade" TEXT;

-- AlterTable: tasks — add bomVersionId
ALTER TABLE "tasks" ADD COLUMN "bom_version_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bom_versions_bom_id_version_no_key" ON "bom_versions"("bom_id", "version_no");
CREATE INDEX "bom_versions_bom_id_idx" ON "bom_versions"("bom_id");
CREATE INDEX "bom_versions_status_idx" ON "bom_versions"("status");

CREATE UNIQUE INDEX "norms_code_key" ON "norms"("code");
CREATE INDEX "norms_category_idx" ON "norms"("category");
CREATE INDEX "norms_project_id_idx" ON "norms"("project_id");

CREATE INDEX "bom_items_bom_version_id_idx" ON "bom_items"("bom_version_id");

-- AddForeignKey
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "bill_of_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "drawing_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_eco_id_fkey" FOREIGN KEY ("eco_id") REFERENCES "engineering_change_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_version_id_fkey" FOREIGN KEY ("bom_version_id") REFERENCES "bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
