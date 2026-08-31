-- Nghiệm thu điểm kiểm ITP cần CẢ PM và QAQC xác nhận (song song, không phân thứ tự).
ALTER TABLE "itp_checkpoints"
  ADD COLUMN IF NOT EXISTS "qc_confirmed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "qc_confirmed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pm_confirmed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "pm_confirmed_at" TIMESTAMP(3);

-- Dữ liệu cũ đã PASSED: coi như cả hai bên đã xác nhận bằng người đã chấm,
-- nếu không các ITP đang Hoàn thành sẽ tụt ngược về dở dang.
UPDATE "itp_checkpoints"
SET "qc_confirmed_by" = COALESCE("qc_confirmed_by", "inspected_by"),
    "qc_confirmed_at" = COALESCE("qc_confirmed_at", "inspected_at"),
    "pm_confirmed_by" = COALESCE("pm_confirmed_by", "inspected_by"),
    "pm_confirmed_at" = COALESCE("pm_confirmed_at", "inspected_at")
WHERE "status" = 'PASSED';
