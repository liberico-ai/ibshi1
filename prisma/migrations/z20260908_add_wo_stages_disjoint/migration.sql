-- Công đoạn trong lệnh có chồng khối lượng lên nhau không.
-- false = lệnh theo hạng mục (cắt rồi hàn cùng một khối thép) → tiến độ lấy công đoạn chậm nhất.
-- true  = lệnh Pha cắt cả dự án (tôn tấm, thép hình, khoan… là khối lượng riêng) → cộng lại.
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "stages_disjoint" BOOLEAN NOT NULL DEFAULT false;
