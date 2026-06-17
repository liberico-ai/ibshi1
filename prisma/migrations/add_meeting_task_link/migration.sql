-- Liên kết lịch họp với công việc nguồn (tạo họp trực tiếp từ 1 task)
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "task_id" TEXT;
CREATE INDEX IF NOT EXISTS "meetings_task_id_idx" ON "meetings"("task_id");
