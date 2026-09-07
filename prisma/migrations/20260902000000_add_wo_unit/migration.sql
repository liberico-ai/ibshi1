-- Đơn vị đo của lệnh sản xuất. Mỗi xưởng làm một khâu nên có thể đo khác nhau:
-- pha cắt / hàn tính kg, sơn tính m², lắp đặt tính mét.
-- Dữ liệu cũ đều là kg nên đặt mặc định 'kg' cho toàn bộ.
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'kg';
