// ─────────────────────────────────────────────────────────────────────────────
// Đơn vị đo của lệnh sản xuất và phiếu báo khối lượng.
//
// Một ITEM giao cho nhiều xưởng, mỗi xưởng làm một khâu và đo bằng đơn vị khác nhau:
// pha cắt / hàn tính kg, sơn tính m², lắp đặt tính mét. Khai một chỗ để màn phát hành WO
// và màn báo khối lượng không bao giờ lệch danh sách.
//
// LƯU Ý: hệ thống KHÔNG quy đổi giữa các đơn vị. Giao theo kg thì lấy được khối lượng của
// ITEM; giao theo đơn vị khác thì PM phải tự nhập số lượng — không có hệ số nào suy ra m²
// từ kg mà đúng cho mọi cấu kiện.
// ─────────────────────────────────────────────────────────────────────────────

export const WO_UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'm', label: 'mét' },
  { value: 'm2', label: 'm²' },
  { value: 'cái', label: 'cái' },
  { value: 'bộ', label: 'bộ' },
] as const

export type WoUnit = (typeof WO_UNITS)[number]['value']

export const DEFAULT_WO_UNIT: WoUnit = 'kg'

/** Nhãn hiển thị của một đơn vị; mã lạ thì trả về chính nó. */
export function unitLabel(unit: string | null | undefined): string {
  return WO_UNITS.find(u => u.value === unit)?.label ?? (unit || DEFAULT_WO_UNIT)
}

export function isValidUnit(unit: string | null | undefined): boolean {
  return WO_UNITS.some(u => u.value === unit)
}
