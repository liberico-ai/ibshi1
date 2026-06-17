-- Lưu vết từng người nhận đã đọc tài liệu MUST_READ
CREATE TABLE IF NOT EXISTS "task_doc_acks" (
  "id"             TEXT NOT NULL,
  "requirement_id" TEXT NOT NULL,
  "user_id"        TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_doc_acks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "task_doc_acks_requirement_id_user_id_key" ON "task_doc_acks"("requirement_id", "user_id");
CREATE INDEX IF NOT EXISTS "task_doc_acks_requirement_id_idx" ON "task_doc_acks"("requirement_id");
ALTER TABLE "task_doc_acks" ADD CONSTRAINT "task_doc_acks_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "task_doc_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
