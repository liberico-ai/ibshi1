// Điều hướng bản mobile /m — chỉ QAQC (R09*) và Xưởng (R06*).
// Nguồn phân quyền vẫn là API; đây chỉ là lớp hiển thị + guard mềm ở client,
// đúng pattern PAGE_ACCESS của dashboard.

export const QC_ROLES = ['R09', 'R09a'] as const
export const SHOPFLOOR_ROLES = ['R06', 'R06a', 'R06b'] as const
/** R01 (BGĐ) + R10 (Admin) vào được để giám sát và test. */
export const MOBILE_EXTRA_ROLES = ['R01', 'R10'] as const

export const MOBILE_ROLES: readonly string[] = [
  ...QC_ROLES,
  ...SHOPFLOOR_ROLES,
  ...MOBILE_EXTRA_ROLES,
]

export type Persona = 'qc' | 'shopfloor' | 'both'

export function getPersona(roleCode: string): Persona | null {
  if ((QC_ROLES as readonly string[]).includes(roleCode)) return 'qc'
  if ((SHOPFLOOR_ROLES as readonly string[]).includes(roleCode)) return 'shopfloor'
  if ((MOBILE_EXTRA_ROLES as readonly string[]).includes(roleCode)) return 'both'
  return null
}

export function canUseMobile(roleCode: string): boolean {
  return MOBILE_ROLES.includes(roleCode)
}

/**
 * Vai được TỰ ĐỘNG đưa vào /m khi đăng nhập trên điện thoại.
 * Cố tình KHÔNG gồm R01/R10: BGĐ và Admin có laptop và cần bản đầy đủ —
 * họ vẫn vào /m được, nhưng phải chủ động, không bị nhốt vào bản rút gọn.
 */
const AUTO_MOBILE_ROLES: readonly string[] = [...QC_ROLES, ...SHOPFLOOR_ROLES]

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk/i

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return MOBILE_UA.test(navigator.userAgent)
}

/**
 * Đích đến sau khi đăng nhập.
 * 1. Có ?next= hợp lệ (đường dẫn nội bộ) → quay lại đúng chỗ người dùng định vào.
 *    Đây là thứ làm cho việc mở thẳng /m và icon PWA hoạt động.
 * 2. Thợ Xưởng / QC trên điện thoại → /m.
 * 3. Còn lại → /dashboard, y như cũ.
 */
export function resolvePostLoginPath(roleCode: string, next?: string | null): string {
  // Chỉ nhận đường dẫn nội bộ — chặn chuyển hướng ra ngoài (//evil.com, http://…)
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  if (AUTO_MOBILE_ROLES.includes(roleCode) && isMobileDevice()) return '/m'
  return '/dashboard'
}

export interface MobileTile {
  key: string
  label: string
  hint: string
  href: string
  /** Trang desktop tương ứng — ghi chú 04 của bản bàn giao. */
  deskLink: string
  persona: Exclude<Persona, 'both'>
  /** Đã dựng xong màn mobile chưa. Chưa xong thì hiện mờ, không cho bấm vào ngõ cụt. */
  ready: boolean
}

/** 6 màn của bản bàn giao. Thứ tự = thứ tự dùng thực tế trong ngày. */
export const MOBILE_TILES: readonly MobileTile[] = [
  {
    key: 'job-cards',
    label: 'Phiếu công đoạn',
    hint: 'Báo sản lượng tại máy',
    href: '/m/prod/job-cards',
    deskLink: '/dashboard/production/job-cards',
    persona: 'shopfloor',
    ready: true,
  },
  {
    key: 'work-orders',
    label: 'Lệnh sản xuất',
    hint: 'Nhận lệnh, theo dõi tiến độ',
    href: '/m/prod/work-orders',
    deskLink: '/dashboard/production',
    persona: 'shopfloor',
    ready: true,
  },
  {
    key: 'weld-map',
    label: 'Weld map',
    hint: 'Xác nhận mối hàn đã hàn',
    href: '/m/prod/weld-map',
    deskLink: '/dashboard/production/weld-map',
    persona: 'shopfloor',
    ready: true,
  },
  {
    key: 'inspections',
    label: 'Nghiệm thu',
    hint: 'Ghi kết quả, chụp ảnh hiện trường',
    href: '/m/qc',
    deskLink: '/dashboard/qc',
    persona: 'qc',
    ready: true,
  },
  {
    key: 'itp',
    label: 'Kế hoạch kiểm tra',
    hint: 'Điểm Hold / Witness',
    href: '/m/qc/itp',
    deskLink: '/dashboard/qc/itp',
    persona: 'qc',
    ready: true,
  },
  {
    key: 'dft',
    label: 'Đo NDT / DFT',
    hint: 'Nhập số đo, so chuẩn',
    href: '/m/qc/dft',
    deskLink: '/dashboard/qc',
    persona: 'qc',
    ready: true,
  },
]

export function tilesForRole(roleCode: string): MobileTile[] {
  const persona = getPersona(roleCode)
  if (!persona) return []
  if (persona === 'both') return [...MOBILE_TILES]
  return MOBILE_TILES.filter((t) => t.persona === persona)
}
