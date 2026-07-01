-- CreateTable
CREATE TABLE "mrb_releases" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RELEASED',
    "snapshot" JSONB NOT NULL,
    "released_by_id" TEXT NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrb_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mrb_releases_project_id_revision_idx" ON "mrb_releases"("project_id", "revision");

-- AddForeignKey
ALTER TABLE "mrb_releases" ADD CONSTRAINT "mrb_releases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
