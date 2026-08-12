-- ============================================================================
-- NHÉT TOÀN BỘ DỰ TOÁN (P1.2) cho dự án 26-VPI-I-113 vào DB — chạy trên PROD.
-- Nguồn số: file "P1.2_26-VPI-I-113_DTTC ... V17568.xlsx" (sheet DT02).
--
-- Ghi 2 nơi → phủ MỌI bước cần dự toán:
--   (1) tasks.result_data của bước P1.2 = nguồn MỌI bước đọc estimate
--       (P2.4, P2.5, các màn previousStepData thiết kế/thương mại, baseline).
--       Chứa: 4 tổng + totalEstimate + dt02Detail (phân rã I/II/III/IV + sub-item)
--       + estimateFileName — ĐÚNG những gì nút "Import Excel" của form P1.2 lưu.
--   (2) budgets 4 nhóm (planned) = Ngân sách + Dòng tiền bảng ③ (DTTC) + Quyết toán.
--
-- An toàn: bọc transaction; idempotent (chạy lại chỉ ghi đè, không trùng dòng);
--          giữ nguyên actual/committed đã có.
-- Lưu ý: app chỉ mô hình hoá tới mức DT02 (tổng + breakdown). Chi tiết DT03–DT07
--        vẫn nằm trong file đính kèm (app cũng không lưu, kể cả khi bấm Import).
-- ============================================================================
BEGIN;

-- (1) Ghi toàn bộ dự toán vào task P1.2 (merge, không đè các key khác của resultData)
UPDATE tasks
SET result_data = COALESCE(result_data, '{}'::jsonb) || '{"totalMaterial":2571309640,"totalLabor":831464650,"totalService":848509100,"totalOverhead":988282708.546403,"totalEstimate":5239566098.546403,"dt02Detail":"[{\"maCP\":\"I\",\"noiDung\":\"Chi phí vật tư\",\"giaTri\":2571309640},{\"maCP\":\"VTC\",\"noiDung\":\"Vật tư chính\",\"giaTri\":1820196140},{\"maCP\":\"VPK\",\"noiDung\":\"Vật tư phụ kiện, bu lông…\",\"giaTri\":158720000},{\"maCP\":\"VDK\",\"noiDung\":\"Vật tư đóng kiện\",\"giaTri\":274893500},{\"maCP\":\"VTH\",\"noiDung\":\"Vật tư tiêu hao\",\"giaTri\":186140000},{\"maCP\":\"VTS\",\"noiDung\":\"Vật tư sơn\",\"giaTri\":31360000},{\"maCP\":\"VTP\",\"noiDung\":\"Vật tư dự phòng\",\"giaTri\":100000000},{\"maCP\":\"II\",\"noiDung\":\"Chi phí nhân công trực tiếp\",\"giaTri\":831464650},{\"maCP\":\"PC\",\"noiDung\":\"Pha cắt\",\"giaTri\":60545700},{\"maCP\":\"GC\",\"noiDung\":\"Gia công\",\"giaTri\":8908700},{\"maCP\":\"CT\",\"noiDung\":\"Chế tạo\",\"giaTri\":400891500},{\"maCP\":\"TA\",\"noiDung\":\"Khung kiện\",\"giaTri\":21600000},{\"maCP\":\"VH\",\"noiDung\":\"Tổ hợp sản phẩm\",\"giaTri\":89087000},{\"maCP\":\"LSS\",\"noiDung\":\"Làm sạch, Sơn\",\"giaTri\":28160000},{\"maCP\":\"ĐK\",\"noiDung\":\"Đóng kiện\",\"giaTri\":17817400},{\"maCP\":\"GH\",\"noiDung\":\"Giao hàng\",\"giaTri\":4454350},{\"maCP\":\"DP\",\"noiDung\":\"Nhân công dự phòng\",\"giaTri\":200000000},{\"maCP\":\"III\",\"noiDung\":\"Chi phí dịch vụ thuê ngoài\",\"giaTri\":848509100},{\"maCP\":\"DVT\",\"noiDung\":\"Vận tải, giao hàng FOB Cảng Hải Phòng\",\"giaTri\":115813100},{\"maCP\":\"DTN\",\"noiDung\":\"NDT, quy trình và thí nghiệm\",\"giaTri\":8908700},{\"maCP\":\"DMK\",\"noiDung\":\"Mạ kẽm\",\"giaTri\":694878600},{\"maCP\":\"DVK\",\"noiDung\":\"Chi phí khác (thủ tục xuất hàng,…)\",\"giaTri\":8908700},{\"maCP\":\"DDP\",\"noiDung\":\"Chi phí dự phòng\",\"giaTri\":20000000},{\"maCP\":\"IV\",\"noiDung\":\"Chi phí chung\",\"giaTri\":988282708.546403},{\"maCP\":\"CPC\",\"noiDung\":\"Chi phí chung phục vụ sản xuất\",\"giaTri\":502633942.107187},{\"maCP\":\"CTC\",\"noiDung\":\"Chi phí tài chính\",\"giaTri\":106716195.709926},{\"maCP\":\"CQL\",\"noiDung\":\"Chi phí Quản Lý\",\"giaTri\":378932570.729289}]","estimateFileName":"P1.2_26-VPI-I-113_DTTC Gia công chế tạo Pipe rack V17568.xlsx"}'::jsonb,
    updated_at = now()
WHERE project_id = (SELECT id FROM projects WHERE project_code = '26-VPI-I-113')
  AND task_type = 'P1.2' AND template_step_id IS NOT NULL;

-- (2) Đồng bộ 4 nhóm tiền sang Budget (Ngân sách / Dòng tiền ③ / Quyết toán)
WITH proj AS (
  SELECT id FROM projects WHERE project_code = '26-VPI-I-113'
),
input(category, planned) AS (
  VALUES
    ('MATERIAL', 2571309640::numeric),
    ('LABOR',     831464650::numeric),
    ('SERVICE',   848509100::numeric),
    ('OVERHEAD',  988282708.546403::numeric)
),
upd AS (
  UPDATE budgets b
     SET planned = i.planned, updated_at = now()
  FROM input i, proj p
  WHERE b.project_id = p.id AND b.category = i.category
    AND b.month IS NULL AND b.year IS NULL
  RETURNING b.category
)
INSERT INTO budgets (id, project_id, category, planned, month, year, created_at, updated_at)
SELECT gen_random_uuid()::text, p.id, i.category, i.planned, NULL, NULL, now(), now()
FROM input i, proj p
WHERE i.category NOT IN (SELECT category FROM upd);

COMMIT;

-- ── KIỂM TRA sau khi chạy ──
-- Task P1.2 đã có 4 tổng?
-- SELECT task_type, result_data->>'totalMaterial' AS mat, result_data->>'totalLabor' AS lab,
--        result_data->>'totalService' AS svc, result_data->>'totalOverhead' AS ovh,
--        result_data->>'totalEstimate' AS tong
-- FROM tasks
-- WHERE project_id = (SELECT id FROM projects WHERE project_code='26-VPI-I-113')
--   AND task_type='P1.2' AND template_step_id IS NOT NULL;
--
-- Budget 4 nhóm?
-- SELECT category, planned, actual, committed FROM budgets
-- WHERE project_id = (SELECT id FROM projects WHERE project_code='26-VPI-I-113')
--   AND month IS NULL AND year IS NULL ORDER BY category;
