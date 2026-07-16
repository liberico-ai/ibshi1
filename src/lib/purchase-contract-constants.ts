// T1 — Hợp đồng mua (PurchaseContract): hằng số RBAC + enum dùng chung giữa các route.

// Xem HĐ: role mua hàng / quản lý dự án / tài chính.
export const CONTRACT_VIEW_ROLES = new Set([
  'R01',        // BGĐ
  'R02', 'R02a', // QLDA
  'R03', 'R03a', // KTKT (kế hoạch/kinh tế)
  'R07', 'R07a', // Thương mại
  'R08', 'R08a', // Tài chính KT
  'R10',        // Admin (thao tác kỹ thuật)
])

// Tạo / sửa / gắn PO: chỉ Thương mại (R07) + BGĐ (R01).
export const CONTRACT_WRITE_ROLES = new Set(['R07', 'R07a', 'R01'])

// Loại HĐ chốt đợt đầu.
export const CONTRACT_TYPES = new Set(['HDMB', 'HDKT', 'KHAC'])

// Trạng thái vòng đời HĐ.
export const CONTRACT_STATUSES = new Set(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'])

export const MAX_STR = 300
