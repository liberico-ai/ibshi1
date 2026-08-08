// Cơ cấu tổ chức RÚT GỌN (hiệu lực tháng 5/2026): Phòng Sản xuất + 12 tổ TO-* được
// thay bằng 5 XƯỞNG (XPC/XCT1/XCT2/XH/XHT) + Site Manager; Kho tách khỏi TCKT; HCNS quay lại.
// LƯU Ý: roleCode GIỮ NGUYÊN, việc vẫn route theo role. ROLE_TO_DEPT giờ chỉ là PHÒNG MẶC ĐỊNH
// cho user mới — phòng THẬT của mỗi user lấy từ User.departmentId (đã gán theo "Bộ phận mới").

export interface DeptDef { code: string; name: string }

export const DEPARTMENTS_V2: DeptDef[] = [
  // Khối Quản trị
  { code: 'BGD', name: 'Ban Giám đốc' },
  { code: 'CNTT', name: 'CNTT & Dữ liệu' },
  // Khối Gián tiếp
  { code: 'KHO', name: 'Bộ phận Kho' },
  { code: 'HCNS', name: 'Phòng Hành chính Nhân sự' },
  { code: 'TCKT', name: 'Phòng Tài chính Kế toán' },
  { code: 'KTKT', name: 'Phòng Kinh tế Kỹ thuật' },
  // Khối Trực tiếp
  { code: 'QLDA', name: 'Phòng Dự án' },
  { code: 'TK', name: 'Phòng Thiết kế' },
  { code: 'QAQC', name: 'Phòng QAQC' },
  { code: 'TB', name: 'Phòng Trang thiết bị' },
  { code: 'XPC', name: 'Xưởng Pha cắt' },
  { code: 'XCT1', name: 'Xưởng Chế tạo số 1' },
  { code: 'XCT2', name: 'Xưởng Chế tạo số 2' },
  { code: 'XH', name: 'Xưởng Hàn' },
  { code: 'XHT', name: 'Xưởng Hoàn thiện' },
  { code: 'SITEMGR', name: 'Site Manager' },
]

// Danh sách 5 xưởng sản xuất (thay 12 tổ TO-*). Dùng cho dropdown "Xưởng" ở lệnh SX.
export const PRODUCTION_WORKSHOPS: DeptDef[] = [
  { code: 'XPC', name: 'Xưởng Pha cắt' },
  { code: 'XCT1', name: 'Xưởng Chế tạo số 1' },
  { code: 'XCT2', name: 'Xưởng Chế tạo số 2' },
  { code: 'XH', name: 'Xưởng Hàn' },
  { code: 'XHT', name: 'Xưởng Hoàn thiện' },
]

// Ánh xạ tổ CŨ (TO-*) → xưởng MỚI — dùng khi migrate dữ liệu công nhân/WO.
export const TEAM_TO_WORKSHOP: Record<string, string> = {
  'TO-PC2': 'XPC', 'TO-PC3': 'XPC', 'TO-GCCK': 'XPC',
  'TO-GL1': 'XCT1', 'TO-GL4': 'XCT1',
  'TO-GL2': 'XCT2', 'TO-GL3': 'XCT2', 'TO-GL5': 'XCT2',
  'TO-HAN1': 'XH', 'TO-HAN2': 'XH',
  'TO-TH': 'XHT', 'TO-SON': 'XHT',
  'TO-CG': 'TB', // Tổ cơ giới → Phòng Trang thiết bị
}

// Phòng MẶC ĐỊNH theo role (chỉ dùng khi user chưa có departmentId thật).
export const ROLE_TO_DEPT: Record<string, string> = {
  R01: 'BGD',
  R02: 'QLDA', R02a: 'QLDA',
  R03: 'KTKT', R03a: 'KTKT',
  R04: 'TK', R04a: 'TK',
  R05: 'KHO', R05a: 'KHO',
  R06: 'XCT1', R06a: 'XCT1', R06b: 'XCT1', // sản xuất — mặc định 1 xưởng; phòng thật theo data
  R07: 'KTKT', R07a: 'KTKT',
  R08: 'TCKT', R08a: 'TCKT',
  R09: 'QAQC', R09a: 'QAQC',
  R10: 'CNTT',
  R11: 'HCNS',
  R13: 'TB', R13a: 'TB',
}

export const DEPT_NAME: Record<string, string> = Object.fromEntries(
  DEPARTMENTS_V2.map((d) => [d.code, d.name]),
)

export function deptOfRole(roleCode?: string | null): string | null {
  if (!roleCode) return null
  return ROLE_TO_DEPT[roleCode] ?? null
}

/** Các roleCode có PHÒNG MẶC ĐỊNH là deptCode — dùng để lọc log theo phòng (xấp xỉ). */
export function rolesOfDept(deptCode: string): string[] {
  return Object.entries(ROLE_TO_DEPT).filter(([, d]) => d === deptCode).map(([r]) => r)
}

export const DEPT_PRIMARY_ROLE: Record<string, string> = {
  BGD: 'R01', CNTT: 'R10', KHO: 'R05', HCNS: 'R11', TCKT: 'R08', KTKT: 'R03',
  QLDA: 'R02', TK: 'R04', QAQC: 'R09', TB: 'R13',
  XPC: 'R06', XCT1: 'R06', XCT2: 'R06', XH: 'R06', XHT: 'R06', SITEMGR: 'R06',
}

export const DEPT_KEYWORDS: Record<string, string[]> = {
  BGD: ['phê duyệt', 'duyệt', 'triển khai', 'phê chuẩn', 'chủ trương', 'đóng dự án', 'quyết định', 'ban giám đốc', 'bgđ'],
  TK: ['thiết kế', 'bản vẽ', 'shop drawing', 'bom', 'định mức', 'apl', 'dttc', 'dự toán kỹ thuật', 'kết cấu', 'quy cách', 'vẽ', 'kỹ thuật', 'eco', 'as-built'],
  QAQC: ['nghiệm thu', 'chất lượng', 'qc', 'qaqc', 'ncr', 'itp', 'kiểm tra', 'inspection', 'mdr', 'hold point', 'kiểm định', 'chứng chỉ', 'mill cert'],
  QLDA: ['dự án', 'kế hoạch', 'tiến độ dự án', 'rủi ro', 'quản lý', 'war zone'],
  KTKT: ['kinh tế', 'kế hoạch', 'hợp đồng', 'định giá', 'vật tư', 'đề xuất vật tư', 'pr ', 'đề nghị mua', 'mua', 'báo giá', 'nhà cung cấp', 'ncc', 'po ', 'đặt hàng', 'thương mại', 'đấu thầu', 'rfq', 'cung ứng', 'ktkt', 'dự toán', 'bóc tách'],
  TCKT: ['thanh toán', 'công nợ', 'hóa đơn', 'kế toán', 'quyết toán', 'dòng tiền', 'giải ngân'],
  KHO: ['nhập kho', 'xuất kho', 'tồn kho', 'kho', 'cấp phát', 'cấp vt'],
  HCNS: ['nhân sự', 'hành chính', 'an toàn', 'hcns', 'tuyển dụng', 'lương', 'chấm công'],
  TB: ['thiết bị', 'máy móc', 'bảo dưỡng', 'cơ giới', 'cẩu', 'xe nâng', 'sửa chữa', 'phụ tùng', 'trang thiết bị'],
  CNTT: ['phần mềm', 'ibs one', 'dữ liệu', 'hệ thống', 'cntt', 'automation', 'ai'],
  // Sản xuất tách theo xưởng
  XPC: ['pha cắt', 'cắt', 'cnc', 'plasma', 'laser', 'gia công cơ khí', 'khoan'],
  XH: ['hàn', 'que hàn', 'thợ hàn'],
  XHT: ['sơn', 'làm sạch', 'phun hạt mài', 'đóng kiện', 'hoàn thiện', 'bảo ôn'],
  XCT1: ['chế tạo', 'gá lắp', 'tổ hợp', 'thợ sắt', 'sản xuất', 'lệnh sản xuất', 'lsx', 'thi công', 'job card', 'phiếu công việc'],
}
