-- Nhiều PM cho một dự án, NGANG QUYỀN nhau.
-- ADDITIVE: thêm 1 bảng, không sửa/xoá cột nào. projects.pm_user_id giữ nguyên và trở thành
-- "PM đầu mối" (người nhận mặc định khi chuỗi tự sinh task vai R02).

CREATE TABLE IF NOT EXISTS "project_pms" (
  "id"          TEXT NOT NULL,
  "project_id"  TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "is_lead"     BOOLEAN NOT NULL DEFAULT false,
  "assigned_by" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_pms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_pms_project_id_user_id_key" ON "project_pms"("project_id", "user_id");
CREATE INDEX IF NOT EXISTS "project_pms_project_id_idx" ON "project_pms"("project_id");
CREATE INDEX IF NOT EXISTS "project_pms_user_id_idx" ON "project_pms"("user_id");

ALTER TABLE "project_pms"
  ADD CONSTRAINT "project_pms_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_pms"
  ADD CONSTRAINT "project_pms_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Chép PM hiện có sang bảng mới, đánh dấu là đầu mối → không dự án nào mất PM sau khi đổi luật.
INSERT INTO "project_pms" ("id", "project_id", "user_id", "is_lead", "assigned_by", "assigned_at")
SELECT 'ppm' || substr(md5(p."id" || p."pm_user_id"), 1, 20), p."id", p."pm_user_id", true, 'SYSTEM', NOW()
FROM "projects" p
WHERE p."pm_user_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = p."pm_user_id")
ON CONFLICT ("project_id", "user_id") DO NOTHING;
