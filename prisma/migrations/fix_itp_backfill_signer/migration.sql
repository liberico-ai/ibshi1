-- Migration add_itp_dual_confirm đã điền CẢ HAI chữ ký bằng người đã chấm Đạt trước đây.
-- Hệ quả: điểm kiểm cũ hiện "PM dự án · <tên người QC>" — gán sai người chịu trách nhiệm.
--
-- Giữ nguyên hai MỐC THỜI GIAN (để ITP cũ không tụt khỏi trạng thái Hoàn thành),
-- nhưng xoá TÊN người ký; giao diện sẽ hiển thị "dữ liệu cũ" thay vì đổ oan cho ai đó.
--
-- Nhận diện dòng bị backfill: cả hai chữ ký cùng một người VÀ cùng đúng mốc inspected_at
-- (hai lần bấm thật của hai người không thể trùng nhau tới mili giây).
UPDATE "itp_checkpoints"
SET "qc_confirmed_by" = NULL,
    "pm_confirmed_by" = NULL
WHERE "status" = 'PASSED'
  AND "qc_confirmed_by" IS NOT NULL
  AND "qc_confirmed_by" = "pm_confirmed_by"
  AND "qc_confirmed_at" = "pm_confirmed_at"
  AND "qc_confirmed_at" = "inspected_at";
