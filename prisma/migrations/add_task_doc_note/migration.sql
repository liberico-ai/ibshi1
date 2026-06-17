-- Tài liệu trả lại có thể đính kèm nội dung dạng text (MUST_RETURN)
ALTER TABLE "task_doc_requirements" ADD COLUMN IF NOT EXISTS "note" TEXT;
