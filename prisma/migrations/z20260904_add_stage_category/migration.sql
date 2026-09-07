-- Công đoạn lấy từ danh mục công việc: lưu cả mã lẫn nhãn của CÔNG ĐOẠN và CHỦNG LOẠI.
-- Mã để đối chiếu chứng từ, nhãn để báo cáo cũ vẫn đọc được khi danh mục đổi tên.
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "stage_code"    TEXT NOT NULL DEFAULT '';
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "category_code" TEXT;
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "category"      TEXT;
