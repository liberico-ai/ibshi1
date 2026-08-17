// Helper dùng chung cho module Phân bổ chế tạo (PORT Thương Mại — bám fabAllocationController.js).
// Vai trò được GHI (thêm/sửa/xóa hạng mục, lưu lưới): KTKT (R03/R03a) + TM (R07/R07a) + PM/BGĐ/Admin.
export const FAB_WRITE_ROLES = ['R01', 'R02', 'R03', 'R03a', 'R07', 'R07a', 'R10']

/** Đọc một số thực. Rỗng / không đọc được → 0. */
export const soThuc = (v: unknown): number => {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Đọc một mốc ngày:
 *   null      — ô để trống (cố ý xóa ngày)
 *   Date      — đọc được
 *   undefined — CÓ gửi giá trị nhưng KHÔNG đọc được → gọi phải báo lỗi, không âm thầm bỏ
 */
export const docNgay = (v: unknown): Date | null | undefined => {
  if (v == null || v === '') return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Ô rỗng = không SL, không KL, không ngày → xóa khỏi DB. */
export const oRong = (qty: number, weight: number, ngay: Date | null | undefined): boolean =>
  qty === 0 && weight === 0 && !ngay

/** Chuẩn hóa một dòng hạng mục từ body hoặc từ file Excel. */
export function chuanHoaHangMuc(row: Record<string, unknown>, i: number) {
  const code = String(row.code ?? row['Mã hạng mục'] ?? '').trim()
  const name = String(row.name ?? row['Tên hạng mục'] ?? '').trim()
  const thu = row.sortOrder ?? row['Thứ tự']
  const ghiChuRaw = row.ghiChu ?? row['Ghi chú']
  return {
    code,
    name,
    sortOrder: Number.isFinite(Number(thu)) && String(thu).trim() !== '' ? Number(thu) : i + 1,
    ghiChu: ghiChuRaw == null || String(ghiChuRaw).trim() === '' ? null : String(ghiChuRaw).trim(),
  }
}
