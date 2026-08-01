-- ============================================================================
-- VỀ HƯU P4.3 / P4.4 — chạy 1 lần trên DB PROD
--   P4.3 = QC nghiệm thu chất lượng nhập kho
--   P4.4 = Kho nghiệm thu số lượng và nhập kho
-- Luồng mới (sidebar theo PO): Hàng về (TM) → QC nghiệm thu → Kho nhập kho.
--
-- GỐC RỄ: task tự sinh do chainNextTemplateTasks đọc gate_codes/next_codes
-- trong bảng template_steps (KHÔNG từ code). Phải xoá gate của P4.3 thì mới
-- ngừng spawn. Bọc trong transaction — an toàn, có thể xem trước bằng ROLLBACK.
-- CHỈ chặn spawn tương lai; task P4.3/P4.4 đã sinh trước đó GIỮ NGUYÊN.
-- ============================================================================
BEGIN;

-- (A1) Chính P4.3/P4.4: xoá sạch gate của chúng (P4.3 đang có gate ['P3.6'])
--      + gỡ tham chiếu chéo trong next_codes (P4.3.next ['P4.4'] → [])
UPDATE template_steps
SET gate_codes = '{}',
    next_codes = array_remove(array_remove(next_codes, 'P4.3'), 'P4.4')
WHERE code IN ('P4.3', 'P4.4');

-- (A2) Mọi step khác: gỡ 'P4.3'/'P4.4' khỏi next_codes & gate_codes
--      (vd P4.5.gate ['P4.4'] → [] để P4.5 không bị chặn)
UPDATE template_steps
SET next_codes = array_remove(array_remove(next_codes, 'P4.3'), 'P4.4'),
    gate_codes = array_remove(array_remove(gate_codes, 'P4.3'), 'P4.4')
WHERE code NOT IN ('P4.3', 'P4.4')
  AND (next_codes && ARRAY['P4.3','P4.4'] OR gate_codes && ARRAY['P4.3','P4.4']);

-- (B) Task P4.3/P4.4 đã sinh trước đó: GIỮ NGUYÊN, không huỷ (theo yêu cầu).

-- ── KIỂM TRA trước khi COMMIT (phải trả 0 dòng thì mới sạch) ──
-- SELECT code, next_codes, gate_codes FROM template_steps
--   WHERE next_codes && ARRAY['P4.3','P4.4'] OR gate_codes && ARRAY['P4.3','P4.4']
--      OR code IN ('P4.3','P4.4');

COMMIT;
-- Nếu muốn xem thử rồi hoàn tác: đổi COMMIT thành ROLLBACK.
