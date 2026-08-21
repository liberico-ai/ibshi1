-- Dọn chỉ mục cũ của work_order_material_requests.
--
-- Bảng này từng được tạo bằng SQL tay (scripts/add-wo-material-requests.sql) với khoá duy nhất
-- (work_order_id, material_id) tên là *_wo_mat_key — khác tên chuẩn của Prisma nên migration
-- trước không xoá trúng. Khoá đó chặn việc đợt sau xin THÊM cùng một vật tư cho cùng một lệnh,
-- trong khi khoá đúng bây giờ là (request_id, work_order_id, material_id).
DROP INDEX IF EXISTS "work_order_material_requests_wo_mat_key";

-- Hai chỉ mục thường bị trùng lặp (đã có bản tên chuẩn *_work_order_id_idx / *_material_id_idx)
DROP INDEX IF EXISTS "work_order_material_requests_wo_idx";
DROP INDEX IF EXISTS "work_order_material_requests_mat_idx";
