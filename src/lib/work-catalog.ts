// ─────────────────────────────────────────────────────────────────────────────
// Danh mục công việc: CÔNG ĐOẠN → CHỦNG LOẠI.
//
// Sinh từ "Danh_muc_cong_viec.xlsx" của nghiệp vụ (05/09/2026) — không gõ tay, không sửa
// trực tiếp file này. Danh mục đổi thì xuất lại từ Excel để mã và nhãn luôn khớp chứng từ.
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

/** Tra công đoạn theo mã. */
export function findStage(code: string | null | undefined): WorkStage | undefined {
  return WORK_STAGES.find(s => s.code === code)
}

/** Chủng loại của một công đoạn; công đoạn không có thì trả mảng rỗng. */
export function categoriesOf(stageCode: string | null | undefined): WorkCategory[] {
  return findStage(stageCode)?.categories ?? []
}

/** Nhãn đầy đủ để hiển thị và lưu, vd "S - Sơn". */
export const stageFullLabel = (s: { code: string; label: string }) => `${s.code} - ${s.label}`
