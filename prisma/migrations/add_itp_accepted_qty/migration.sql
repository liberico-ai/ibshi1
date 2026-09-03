-- Nghiệm thu theo ĐỢT: mỗi ITP nghiệm thu một khối lượng, cộng dồn qua nhiều đợt.
ALTER TABLE "inspection_test_plans" ADD COLUMN IF NOT EXISTS "accepted_qty" DECIMAL(65,30);

-- Backfill dữ liệu cũ: trước đây một lệnh chỉ nghiệm thu MỘT lần cho toàn bộ khối lượng.
-- Với lệnh đang QC_PASSED/COMPLETED và có đúng một ITP đã xong, gán đợt đó = KL đã báo cáo
-- của lệnh — giữ nguyên con số đang hiển thị, không đẻ ra khối lượng mới.
UPDATE "inspection_test_plans" itp
SET "accepted_qty" = wo."completed_qty"
FROM "work_orders" wo
WHERE itp."work_order_id" = wo."id"
  AND itp."accepted_qty" IS NULL
  AND itp."status" = 'COMPLETED'
  AND wo."status" IN ('QC_PASSED', 'COMPLETED')
  AND (SELECT COUNT(*) FROM "inspection_test_plans" x
       WHERE x."work_order_id" = wo."id" AND x."status" = 'COMPLETED') = 1;
