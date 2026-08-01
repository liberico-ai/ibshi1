-- ============================================================================
-- VỀ HƯU P4.3 / P4.4 — chạy 1 lần trên DB PROD
--   P4.3 = QC nghiệm thu chất lượng nhập kho
--   P4.4 = Kho nghiệm thu số lượng và nhập kho
-- Luồng mới (sidebar theo PO): Hàng về (TM) → QC nghiệm thu → Kho nhập kho.
--
-- GỐC RỄ: task tự sinh do chainNextTemplateTasks đọc gate_codes/next_codes
-- trong bảng template_steps (KHÔNG từ code). Phải xoá gate của P4.3 thì mới
-- ngừng spawn. Bọc trong transaction — an toàn, có thể xem trước bằng ROLLBACK.
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

-- (B) Huỷ mềm task P4.3/P4.4 đang mở + ghi lịch sử (chỉ những task vừa huỷ)
WITH cancelled AS (
  UPDATE tasks
  SET status = 'CANCELLED', updated_at = now()
  WHERE task_type IN ('P4.3', 'P4.4')
    AND status IN ('OPEN', 'IN_PROGRESS', 'RETURNED', 'AWAITING_REVIEW')
  RETURNING id
)
INSERT INTO task_history (id, task_id, action, by_user_id, reason, created_at)
SELECT gen_random_uuid()::text, id, 'CANCELLED', 'system',
       'Retire P4.3/P4.4 — chuyển sang luồng sidebar (Hàng về → QC → Kho)', now()
FROM cancelled;

-- ── KIỂM TRA trước khi COMMIT (phải trả 0 dòng thì mới sạch) ──
-- SELECT code, next_codes, gate_codes FROM template_steps
--   WHERE next_codes && ARRAY['P4.3','P4.4'] OR gate_codes && ARRAY['P4.3','P4.4']
--      OR code IN ('P4.3','P4.4');
-- SELECT count(*) FROM tasks
--   WHERE task_type IN ('P4.3','P4.4')
--     AND status IN ('OPEN','IN_PROGRESS','RETURNED','AWAITING_REVIEW');

COMMIT;
-- Nếu muốn xem thử rồi hoàn tác: đổi COMMIT thành ROLLBACK.
