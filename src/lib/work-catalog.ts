// ─────────────────────────────────────────────────────────────────────────────
// Danh mục công việc: CÔNG ĐOẠN → CHỦNG LOẠI.
//
// Sinh từ "Danh_muc_cong_viec.xlsx" của nghiệp vụ (05/09/2026) — không gõ tay, không sửa
// trực tiếp file này. Danh mục đổi thì xuất lại từ Excel để mã và nhãn luôn khớp chứng từ.
//
// NGOẠI LỆ: công đoạn PC (Pha cắt) có thêm hai chủng loại Khoan và Sấn lốc, thêm tay
// 07/09/2026 theo yêu cầu nghiệp vụ. Xuất lại từ Excel thì nhớ giữ chúng.
//
// Dùng khi PM phân giao công đoạn bên trong lệnh sản xuất của một xưởng.
// Công đoạn không có chủng loại nào (GEN, GH) thì bỏ trống ô chủng loại.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkCategory { code: string; label: string }
export interface WorkStage { code: string; label: string; categories: WorkCategory[] }

export const WORK_STAGES: WorkStage[] = [
  {
    code: 'Ax', label: 'Rửa Acid',
    categories: [
      { code: 'Ax', label: 'Rửa acid; Xà phòng - inox, hợp kim' },
    ],
  },
  {
    code: 'BO', label: 'Bảo ôn',
    categories: [
      { code: 'PH', label: 'Bảo ôn Phen ngựa (bông + Liner)' },
      { code: 'SD', label: 'Bảo ôn dạng hộp đính thẳng (Stud) (Bông + Liner)' },
      { code: 'SC', label: 'Bảo ôn các loại với đính dạng Scalope (Chân tôn) (Bông + Liner)' },
    ],
  },
  {
    code: 'ĐK', label: 'Đóng kiện',
    categories: [
      { code: 'HR', label: 'Đóng kiện hàng rời' },
      { code: 'KH', label: 'Đóng kiện hàng khối (Block, ống khói, Hộp lớn...)' },
    ],
  },
  {
    code: 'G', label: 'Gá',
    categories: [
      { code: 'KC', label: 'Kết cấu' },
      { code: 'TB', label: 'Thiết bị' },
      { code: 'CT', label: 'Cầu thang lan can' },
      { code: 'TĐ', label: 'Tổng đoạn' },
    ],
  },
  {
    code: 'GC', label: 'Gia công',
    categories: [
      { code: 'SL', label: 'Sấn lốc' },
      { code: 'KH', label: 'Gia công Khoan' },
      { code: 'CK', label: 'Gia công chính xác (tiện)' },
    ],
  },
  {
    code: 'GEN', label: 'Các mục công việc phục vụ chung',
    categories: [
    ],
  },
  {
    code: 'GH', label: 'Giao hàng',
    categories: [
    ],
  },
  {
    code: 'H', label: 'Hàn',
    categories: [
      { code: 'KC', label: 'Kết cấu' },
      { code: 'KK', label: 'Khung kiện' },
      { code: 'TB', label: 'Thiết bị' },
      { code: 'CT', label: 'Cầu thang lan can' },
    ],
  },
  {
    code: 'LS', label: 'Làm sạch',
    categories: [
      { code: 'TB', label: 'Làm sạch KC, Thiết bị (Thợ làm sạch và phụ làm sạch)' },
      { code: 'BL', label: 'Block' },
      { code: 'KK', label: 'Khung kiện' },
      { code: 'IN', label: 'Inox, hợp kim' },
    ],
  },
  {
    code: 'PC', label: 'Pha cắt',
    categories: [
      { code: 'TT', label: 'Tôn tấm' },
      { code: 'TH', label: 'Thép hình' },
      { code: 'IN', label: 'Inox, hợp kim' },
      // Hai chủng loại dưới đây THÊM TAY theo yêu cầu nghiệp vụ 07/09/2026, không có trong
      // Danh_muc_cong_viec.xlsx. Xưởng Pha cắt chuẩn bị vật tư cho MỌI công đoạn sau, nên
      // khoan và sấn lốc nằm luôn trong khâu pha cắt chứ không tách sang Gia công.
      // Xuất lại danh mục từ Excel thì phải giữ hai dòng này.
      { code: 'KH', label: 'Khoan' },
      { code: 'SL', label: 'Sấn lốc' },
    ],
  },
  {
    code: 'PS', label: 'Phát sinh',
    categories: [
      { code: 'PS', label: 'Phát sinh' },
    ],
  },
  {
    code: 'S', label: 'Sơn',
    categories: [
      { code: 'TB', label: 'Sơn KC, Thiết bị (Sơn, sửa sơn nghiệm thu)' },
      { code: 'BL', label: 'Block' },
      { code: 'KK', label: 'Khung kiện' },
      // Sơn theo LỚP — thêm 2026-08 cho Xưởng Hoàn thiện (giao cả dự án).
      { code: 'SL1', label: 'Sơn lớp 1' },
      { code: 'SL2', label: 'Sơn lớp 2' },
      { code: 'SL3', label: 'Sơn lớp 3' },
    ],
  },
  {
    code: 'TA', label: 'Thử áp',
    categories: [
      { code: 'TA', label: 'Thử áp' },
    ],
  },
  {
    code: 'TH', label: 'Tổ hợp',
    categories: [
      { code: 'KC', label: 'Kết cấu' },
      { code: 'TB', label: 'Thiết bị' },
      { code: 'BL', label: 'Block' },
    ],
  },
  {
    code: 'VH', label: 'Vận Hành',
    categories: [
      { code: 'CN', label: 'Chức năng' },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Bảng CÔNG ĐOẠN → XƯỞNG (chốt nghiệp vụ 2026-08). Dùng để dựng "sổ đơn giá" khi export
// file đơn giá khoán: mỗi xưởng hiện MỌI hạng mục kèm ĐÚNG các công đoạn của xưởng đó (không
// phụ thuộc đã giao lệnh hay chưa). XCT1 và XCT2 cùng làm Gá + Tổ hợp.
// ─────────────────────────────────────────────────────────────────────────────
// XƯỞNG GIAO THEO HẠNG MỤC (per-item). XPC + XHT KHÔNG ở đây — họ giao cả dự án, khai riêng ở
// WHOLE_PROJECT_STAGES bên dưới.
export const WORKSHOP_STAGES: Record<string, string[]> = {
  XCT1: ['G', 'TH'],                             // Gá, Tổ hợp
  XCT2: ['G', 'TH'],
  XHAN: ['H'],                                   // Hàn
}
export const stagesOfWorkshop = (teamCode: string | null | undefined): string[] =>
  WORKSHOP_STAGES[teamCode || ''] ?? []

// Xưởng GIAO CẢ DỰ ÁN (không theo hạng mục) + các công đoạn của họ trong khối "giao cả dự án".
// XPC chuẩn bị phôi cho mọi hạng mục; XHT (Hoàn thiện) sơn/bảo ôn/đóng kiện… cả dự án. Mỗi
// (công đoạn × chủng loại) là một khối lượng RỜI NHAU do PM nhập.
export const WHOLE_PROJECT_STAGES: Record<string, string[]> = {
  XPC: ['PC'],
  XHT: ['LS', 'S', 'BO', 'ĐK', 'TA', 'Ax', 'VH', 'GH'],
}
export const isWholeProjectWorkshop = (teamCode: string | null | undefined): boolean =>
  !!WHOLE_PROJECT_STAGES[teamCode || '']

/** Tra công đoạn theo mã. */
export function findStage(code: string | null | undefined): WorkStage | undefined {
  return WORK_STAGES.find(s => s.code === code)
}

/** Chủng loại của một công đoạn; công đoạn không có thì trả mảng rỗng. */
export function categoriesOf(stageCode: string | null | undefined): WorkCategory[] {
  return findStage(stageCode)?.categories ?? []
}

/**
 * Mã "Khác" — chủng loại tự nhập ngoài danh mục. Đơn giá của mọi chủng loại lạ trong một
 * (ITEM × Xưởng) đều lấy MỘT giá "Khác" chung: item A khác 2000 thì mọi chủng loại lạ ở A là
 * 2000, item B khác 2500 thì mọi chủng loại lạ ở B là 2500 (chốt nghiệp vụ 2026-08).
 */
export const KHAC_CATEGORY = 'KHAC'

/**
 * Chủng loại này có nằm trong DANH MỤC của công đoạn không?
 * Không nằm trong danh mục = chủng loại "lạ" → ăn đơn giá "Khác".
 * (KHAC là sentinel của chính mục "Khác", cũng coi là ngoài danh mục.)
 */
export function isCatalogCategory(stageCode: string | null | undefined, categoryCode: string | null | undefined): boolean {
  if (!categoryCode || categoryCode === KHAC_CATEGORY) return false
  return categoriesOf(stageCode).some(c => c.code === categoryCode)
}

/** Nhãn đầy đủ để hiển thị và lưu, vd "S - Sơn". */
export const stageFullLabel = (s: { code: string; label: string }) => `${s.code} - ${s.label}`
