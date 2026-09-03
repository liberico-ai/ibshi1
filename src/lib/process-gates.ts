import { makeConfigFlag } from './config-flag'

// ─────────────────────────────────────────────────────────────────────────────
// Các CỔNG quy trình đang tạm cắt (09/2026) để chạy được số liệu cho dự án đã làm xong.
// Luật vẫn nằm nguyên trong code, chỉ bọc sau cờ. Bật lại = đổi một dòng system_config.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cổng vật tư của lệnh sản xuất.
 * BẬT  → phải được Kho cấp đủ 100% danh mục mới bấm được "Bắt đầu SX" (luật gốc).
 * TẮT  → xưởng bắt đầu ngay từ trạng thái "Chờ vật tư"; nhánh DNC → duyệt → cấp vẫn chạy
 *        song song, chỉ mất tư cách chặn.
 */
export const WO_MATERIAL_GATE_KEY = 'ff_wo_require_material'
export const woMaterialGate = makeConfigFlag({
  key: WO_MATERIAL_GATE_KEY,
  envVar: 'FF_WO_REQUIRE_MATERIAL',
  defaultValue: false,
})

/**
 * Cổng biên bản nghiệm thu của điểm kiểm ITP.
 * BẬT  → phải đính kèm biên bản mới chấm Đạt được (luật gốc).
 * TẮT  → ký xác nhận Đạt được mà chưa có biên bản; vẫn đính kèm sau được, và điểm kiểm
 *        ĐÃ CHẤM thì vẫn không cho gỡ biên bản đã có (xem DELETE /api/upload/[id]).
 */
export const ITP_MINUTES_GATE_KEY = 'ff_itp_require_minutes'
export const itpMinutesGate = makeConfigFlag({
  key: ITP_MINUTES_GATE_KEY,
  envVar: 'FF_ITP_REQUIRE_MINUTES',
  defaultValue: false,
})

/** Mọi cổng — dùng cho màn quản trị cấu hình và để xoá cache hàng loạt. */
export const ALL_PROCESS_GATES = [woMaterialGate, itpMinutesGate]
export const PROCESS_GATE_KEYS = ALL_PROCESS_GATES.map(g => g.key)
