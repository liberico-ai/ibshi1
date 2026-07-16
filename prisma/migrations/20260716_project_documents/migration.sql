-- T5 — Sổ tài liệu dự án (Project Document Register)
--
-- Bảng mới, hoàn toàn ADDITIVE: chỉ CREATE TABLE IF NOT EXISTS + index.
-- Không đụng bảng/cột cũ ⟹ an toàn với DB prod (history prod≠local, không reset).
-- Mọi câu lệnh idempotent (chạy lại được).
--
-- File thật vẫn nằm ở file_attachments (entity_type='ProjectDoc'); bảng này chỉ
-- giữ metadata sổ tài liệu và tham chiếu mềm tới file_attachments.id qua file_attachment_id.

CREATE TABLE IF NOT EXISTS "project_documents" (
  "id"                 TEXT NOT NULL,
  "project_id"         TEXT NOT NULL,
  "doc_code"           TEXT NOT NULL,
  "doc_type"           TEXT NOT NULL,
  "revision"           TEXT NOT NULL DEFAULT 'Rev0',
  "dept_code"          TEXT,
  "title"              TEXT NOT NULL,
  "file_attachment_id" TEXT,
  "task_id"            TEXT,
  "status"             TEXT NOT NULL DEFAULT 'ACTIVE',
  "uploaded_by"        TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "project_documents_project_id_idx" ON "project_documents" ("project_id");
CREATE INDEX IF NOT EXISTS "project_documents_doc_type_idx"   ON "project_documents" ("doc_type");
CREATE INDEX IF NOT EXISTS "project_documents_dept_code_idx"  ON "project_documents" ("dept_code");

-- FK tới projects (idempotent: chỉ thêm nếu chưa có)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_documents_project_id_fkey'
  ) THEN
    ALTER TABLE "project_documents"
      ADD CONSTRAINT "project_documents_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
