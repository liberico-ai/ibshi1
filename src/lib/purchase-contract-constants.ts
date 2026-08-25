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

// B7 — Duyệt điều kiện thanh toán: 3 chốt ký. slot → role được ký.
// finance = Kế toán (R08/R08a) · ktkt = Trưởng KTKT "Mr Sâm" (R03) · bod = BGĐ (R01).
export const PT_APPROVAL_SLOTS = ['finance', 'ktkt', 'bod'] as const
export type PtSlot = (typeof PT_APPROVAL_SLOTS)[number]
export const PT_SLOT_ROLES: Record<PtSlot, string[]> = {
  finance: ['R08', 'R08a'],
  ktkt: ['R03'],
  bod: ['R01'],
}
export const PT_SLOT_LABEL: Record<PtSlot, string> = {
  finance: 'Kế toán', ktkt: 'Trưởng KTKT (Mr Sâm)', bod: 'Ban Giám đốc',
}
// Ai được đưa HĐ vào trình duyệt điều kiện TT (submit): Thương mại + BGĐ.
export const PT_SUBMIT_ROLES = new Set(['R07', 'R07a', 'R01', 'R10'])

export const MAX_STR = 300
