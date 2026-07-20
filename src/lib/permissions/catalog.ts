// ── Danh mục khả năng (capability catalog) ──
// "Tính năng" = dòng của ma trận phân quyền. Khai trong CODE vì gắn với tính năng,
// còn "ai được cấp" thì nằm trong DB (Role.permissions + SystemConfig).
//
// Ba loại (kind):
//   page   — thay MENU_ITEMS[].roles (ai vào được trang nào)
//   action — thay RBAC.* (ai làm được thao tác nghiệp vụ nào)
//   form   — thay FORM_EDIT_ROLES (ai sửa được biểu mẫu nào)

import { MENU_ITEMS, FORM_EDIT_ROLES } from '../constants'

export type CapKind = 'page' | 'action' | 'form'

export interface Capability {
  key: string
  label: string
  module: string
  kind: CapKind
}

// ── Khả năng thao tác nghiệp vụ (ánh xạ từ RBAC.* trong rbac-rules.ts) ──
export const ACTION_CAPABILITIES: Capability[] = [
  { key: 'action.production',           label: 'Thao tác sản xuất (LSX, phiếu công đoạn)', module: 'Sản xuất', kind: 'action' },
  { key: 'action.qc',                   label: 'Thao tác QC (nghiệm thu, ITP, NCR)',       module: 'QC',       kind: 'action' },
  { key: 'action.store',                label: 'Thao tác kho (nhập/xuất)',                 module: 'Kho',      kind: 'action' },
  { key: 'action.pr_approval',          label: 'Duyệt đề nghị mua hàng (PR)',              module: 'Mua hàng', kind: 'action' },
  { key: 'action.subcontract',          label: 'Thao tác thầu phụ',                        module: 'Mua hàng', kind: 'action' },
  { key: 'action.material_code_admin',  label: 'Quản lý danh mục mã vật tư',               module: 'Kho',      kind: 'action' },
  { key: 'action.material_code_promote',label: 'Chuẩn hoá mã tạm → mã chuẩn',              module: 'Kho',      kind: 'action' },
  { key: 'action.material_code_merge',  label: 'Gộp mã vật tư trùng (rủi ro cao)',         module: 'Kho',      kind: 'action' },
  { key: 'action.norm',                 label: 'Quản lý định mức tiêu hao',                module: 'Kỹ thuật', kind: 'action' },
  { key: 'admin.manage_permissions',    label: 'Quản lý phân quyền',                        module: 'Hệ thống', kind: 'action' },
]

// Ánh xạ 1-1 giữa khả năng action và tên nhóm trong RBAC (rbac-rules.ts).
// Dùng cho bootstrap để nạp đúng luật cũ. 'admin.manage_permissions' không có
// nhóm RBAC tương ứng — mặc định chỉ R10 (xử lý riêng trong bootstrap).
export const ACTION_TO_RBAC: Record<string, string> = {
  'action.production':            'PRODUCTION_ACTION',
  'action.qc':                    'QC_ACTION',
  'action.store':                 'STORE_ACTION',
  'action.pr_approval':           'PR_APPROVAL',
  'action.subcontract':           'SUBCONTRACT_ACTION',
  'action.material_code_admin':   'MATERIAL_CODE_ADMIN',
  'action.material_code_promote': 'MATERIAL_CODE_PROMOTE',
  'action.material_code_merge':   'MATERIAL_CODE_MERGE',
  'action.norm':                  'NORM_ACTION',
}

// ── Khả năng sửa biểu mẫu (ánh xạ từ FORM_EDIT_ROLES) ──
const FORM_LABELS: Record<string, string> = {
  ESTIMATE: 'Sửa dự toán', PR: 'Sửa đề nghị mua hàng', BBH: 'Sửa biên bản họp',
  WBS: 'Sửa WBS / cột mốc', WELD_PAINT: 'Sửa dữ liệu hàn & sơn', BOM: 'Sửa BOM',
  SUPPLIER_QUOTE: 'Sửa báo giá NCC',
}
export const FORM_CAPABILITIES: Capability[] = Object.keys(FORM_EDIT_ROLES).map((f) => ({
  key: `form.${f}`,
  label: FORM_LABELS[f] || `Sửa ${f}`,
  module: 'Biểu mẫu',
  kind: 'form' as const,
}))

// ── Khả năng xem trang (sinh từ MENU_ITEMS, giữ đồng bộ tự động) ──
const GROUP_LABELS: Record<string, string> = {
  overview: 'Tổng quan', management: 'Điều hành', project: 'Dự án', design: 'Thiết kế',
  warehouse: 'Kho & Mua hàng', production: 'Sản xuất', logistics: 'Giao vận', tbcg: 'Thiết bị',
  hse: 'An toàn', qc: 'QC', hr: 'Nhân sự', finance: 'Tài chính', reports: 'Báo cáo', system: 'Hệ thống',
}
export const PAGE_CAPABILITIES: Capability[] = MENU_ITEMS.map((m) => ({
  key: `page.${m.key}`,
  label: `Xem: ${m.label}`,
  module: `Trang · ${GROUP_LABELS[m.group] || m.group}`,
  kind: 'page' as const,
}))

// key trang → key menu (để bootstrap tra MENU_ITEMS.roles)
export const PAGE_TO_MENU_KEY: Record<string, string> = Object.fromEntries(
  MENU_ITEMS.map((m) => [`page.${m.key}`, m.key]),
)

// ── Toàn bộ danh mục ──
export const CAPABILITIES: Capability[] = [
  ...ACTION_CAPABILITIES,
  ...FORM_CAPABILITIES,
  ...PAGE_CAPABILITIES,
]

export const CAPABILITY_KEYS: string[] = CAPABILITIES.map((c) => c.key)
const CAP_SET = new Set(CAPABILITY_KEYS)

export function isKnownCapability(key: string): boolean {
  return CAP_SET.has(key)
}

// Gom theo module cho giao diện admin
export function capabilitiesByModule(): { module: string; caps: Capability[] }[] {
  const map = new Map<string, Capability[]>()
  for (const c of CAPABILITIES) {
    if (!map.has(c.module)) map.set(c.module, [])
    map.get(c.module)!.push(c)
  }
  return [...map.entries()].map(([module, caps]) => ({ module, caps }))
}
