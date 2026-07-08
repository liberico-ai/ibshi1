// Cơ cấu tổ chức chuẩn 10 phòng (hiệu lực Q3/2026).
// ROLE_TO_DEPT là nguồn gốc duy nhất cho ánh xạ role → phòng.

export interface DeptDef { code: string; name: string }

export const DEPARTMENTS_V2: DeptDef[] = [
  { code: 'BGD', name: 'Ban Giám đốc' },
  { code: 'CNTT', name: 'CNTT & Dữ liệu' },
  { code: 'TK', name: 'Phòng Kỹ thuật' },
  { code: 'KTKT', name: 'Kinh tế Kỹ thuật' },
  { code: 'QLDA', name: 'Quản lý Dự án' },
  { code: 'SX', name: 'Sản xuất' },
  { code: 'TCKT', name: 'Tài chính Kế toán & Kho' },
  { code: 'QC', name: 'QA/QC' },
  { code: 'TBCG', name: 'Thiết bị & Cơ giới' },
]

export const ROLE_TO_DEPT: Record<string, string> = {
  R01: 'BGD',
  R02: 'QLDA', R02a: 'QLDA',
  R03: 'KTKT', R03a: 'KTKT',
  R04: 'TK', R04a: 'TK',
  R05: 'TCKT', R05a: 'TCKT', R08: 'TCKT', R08a: 'TCKT',
  R06: 'SX', R06a: 'SX', R06b: 'SX',
  R07: 'KTKT', R07a: 'KTKT',
  R09: 'QC', R09a: 'QC',
  R10: 'CNTT',
  R13: 'TBCG',
}

export const DEPT_NAME: Record<string, string> = Object.fromEntries(
  DEPARTMENTS_V2.map((d) => [d.code, d.name]),
)

export function deptOfRole(roleCode?: string | null): string | null {
  if (!roleCode) return null
  return ROLE_TO_DEPT[roleCode] ?? null
}

export const DEPT_PRIMARY_ROLE: Record<string, string> = {
  BGD: 'R01', CNTT: 'R10', TK: 'R04', KTKT: 'R03',
  QLDA: 'R02', SX: 'R06', TCKT: 'R08', QC: 'R09', TBCG: 'R13',
}

export const DEPT_KEYWORDS: Record<string, string[]> = {
  BGD: ['phê duyệt', 'duyệt', 'triển khai', 'phê chuẩn', 'chủ trương', 'đóng dự án', 'quyết định', 'ban giám đốc', 'bgđ'],
  TK: ['thiết kế', 'bản vẽ', 'shop drawing', 'bom', 'định mức', 'apl', 'dttc', 'dự toán kỹ thuật', 'kết cấu', 'quy cách', 'vẽ', 'kỹ thuật', 'eco', 'as-built'],
  QC: ['nghiệm thu', 'chất lượng', 'qc', 'qaqc', 'ncr', 'itp', 'kiểm tra', 'inspection', 'mdr', 'hold point', 'kiểm định', 'chứng chỉ', 'mill cert'],
  SX: ['sản xuất', 'lệnh sản xuất', 'lsx', 'tổ đội', 'thi công', 'hàn', 'cắt', 'lắp', 'tiến độ', 's-curve', 'war zone', 'wbs', 'milestone', 'kickoff', 'thầu phụ', 'job card', 'phiếu công việc'],
  QLDA: ['dự án', 'kế hoạch', 'tiến độ dự án', 'rủi ro', 'quản lý', 'war zone'],
  KTKT: ['kinh tế', 'kế hoạch', 'hợp đồng', 'định giá', 'vật tư', 'đề xuất vật tư', 'pr ', 'đề nghị mua', 'mua', 'báo giá', 'nhà cung cấp', 'ncc', 'po ', 'đặt hàng', 'thương mại', 'đấu thầu', 'rfq', 'cung ứng', 'ktkt', 'dự toán', 'bóc tách'],
  TCKT: ['nhập kho', 'xuất kho', 'tồn kho', 'kho', 'thanh toán', 'công nợ', 'hóa đơn', 'kế toán', 'quyết toán', 'dòng tiền', 'giải ngân', 'cấp phát', 'cấp vt'],
  TBCG: ['thiết bị', 'máy móc', 'bảo dưỡng', 'cơ giới', 'cẩu', 'xe nâng', 'sửa chữa', 'phụ tùng'],
  CNTT: ['phần mềm', 'ibs one', 'dữ liệu', 'hệ thống', 'cntt', 'automation', 'ai'],
}
