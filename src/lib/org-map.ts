// Cơ cấu tổ chức mới (hiệu lực Q3/2026) + ánh xạ role cũ (R0x) → phòng mới.
// Dùng cho định tuyến/gợi ý phòng ban trong workflow động. Không thay RBAC/role hiện có.

export interface DeptDef { code: string; name: string; block: string }

export const DEPARTMENTS_V2: DeptDef[] = [
  { code: 'BOM', name: 'Ban Giám đốc (BOM)', block: 'BOM' },
  { code: 'PKT', name: 'Phòng Kỹ thuật', block: 'KHOI1' },
  { code: 'PQAQC', name: 'Phòng QA/QC', block: 'KHOI1' },
  { code: 'PSXDA', name: 'Phòng Sản xuất + Dự án', block: 'KHOI1' },
  { code: 'PTTBCG', name: 'Phòng Trang thiết bị + Cơ giới', block: 'KHOI1' },
  { code: 'PKTKT', name: 'Phòng Kinh Tế Kỹ thuật', block: 'KHOI2' },
  { code: 'PTCKTKHO', name: 'Phòng TCKT + Kho', block: 'KHOI2' },
  { code: 'HCNS', name: 'Phòng Hành chính Nhân sự', block: 'KHOI2' },
  { code: 'HSE', name: 'Ban An toàn (HSE)', block: 'KHOI2' },
  { code: 'BPCNTT', name: 'BP CNTT & Dữ liệu', block: 'KHOITT' },
]

// roleCode (cũ) → deptCode (mới). Giữ R-code làm chức danh bên trong phòng.
export const ROLE_TO_DEPT: Record<string, string> = {
  R01: 'BOM',
  R02: 'PSXDA', R02a: 'PSXDA', R06: 'PSXDA', R06a: 'PSXDA', R06b: 'PSXDA',
  R04: 'PKT', R04a: 'PKT',
  R09: 'PQAQC', R09a: 'PQAQC',
  R03: 'PKTKT', R03a: 'PKTKT', R07: 'PKTKT', R07a: 'PKTKT',
  R08: 'PTCKTKHO', R08a: 'PTCKTKHO', R05: 'PTCKTKHO', R05a: 'PTCKTKHO',
  R10: 'BPCNTT', R00: 'BPCNTT',
}

export const DEPT_NAME: Record<string, string> = Object.fromEntries(
  DEPARTMENTS_V2.map((d) => [d.code, d.name]),
)

export function deptOfRole(roleCode?: string | null): string | null {
  if (!roleCode) return null
  return ROLE_TO_DEPT[roleCode] ?? null
}

// Role đại diện của mỗi phòng (để gán "cả phòng" qua 1 roleCode khi gợi ý)
export const DEPT_PRIMARY_ROLE: Record<string, string> = {
  BOM: 'R01', PKT: 'R04', PQAQC: 'R09', PSXDA: 'R02', PTTBCG: 'R06',
  PKTKT: 'R03', PTCKTKHO: 'R08', HCNS: 'R10', HSE: 'R09', BPCNTT: 'R10',
}

// Từ điển từ khóa → phòng (suy từ chức năng nhiệm vụ + quy trình). Lowercase, so khớp 'includes'.
export const DEPT_KEYWORDS: Record<string, string[]> = {
  BOM: ['phê duyệt', 'duyệt', 'triển khai', 'phê chuẩn', 'chủ trương', 'đóng dự án', 'quyết định', 'ban giám đốc', 'bgđ'],
  PKT: ['thiết kế', 'bản vẽ', 'shop drawing', 'bom', 'định mức', 'apl', 'dttc', 'dự toán kỹ thuật', 'kết cấu', 'quy cách', 'vẽ', 'kỹ thuật', 'eco', 'as-built'],
  PQAQC: ['nghiệm thu', 'chất lượng', 'qc', 'qaqc', 'ncr', 'itp', 'kiểm tra', 'inspection', 'mdr', 'hold point', 'kiểm định', 'chứng chỉ', 'mill cert'],
  PSXDA: ['sản xuất', 'lệnh sản xuất', 'lsx', 'tổ đội', 'thi công', 'hàn', 'cắt', 'lắp', 'tiến độ', 's-curve', 'war zone', 'wbs', 'milestone', 'kickoff', 'thầu phụ', 'kế hoạch', 'job card', 'phiếu công việc'],
  PKTKT: ['vật tư', 'mua', 'báo giá', 'nhà cung cấp', 'ncc', 'pr ', 'po ', 'đặt hàng', 'đề nghị mua', 'thương mại', 'hợp đồng', 'đấu thầu', 'rfq', 'định giá', 'cung ứng', 'đề xuất vật tư'],
  PTCKTKHO: ['nhập kho', 'xuất kho', 'tồn kho', 'kho', 'thanh toán', 'công nợ', 'hóa đơn', 'kế toán', 'quyết toán', 'dòng tiền', 'giải ngân', 'cấp phát', 'cấp vt'],
  HSE: ['an toàn', 'hse', 'sự cố', 'tai nạn', 'môi trường', 'sức khỏe'],
  HCNS: ['nhân sự', 'tuyển', 'lương', 'khoán', 'bhxh', 'đào tạo', 'hợp đồng lao động', 'chấm công', 'nghỉ phép'],
  PTTBCG: ['thiết bị', 'máy móc', 'bảo dưỡng', 'cơ giới', 'cẩu', 'xe nâng', 'sửa chữa', 'phụ tùng'],
  BPCNTT: ['phần mềm', 'ibs one', 'dữ liệu', 'hệ thống', 'cntt', 'automation', 'ai'],
}
