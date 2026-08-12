-- Xóa mềm dự án: thêm cột deleted_at (nullable) cho bảng projects.
-- ADDITIVE, nullable → an toàn, không ảnh hưởng dữ liệu hiện có.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "projects_deleted_at_idx" ON "projects"("deleted_at");
