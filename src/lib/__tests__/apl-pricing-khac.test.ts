import { describe, it, expect } from 'vitest'
import { shopKey, resolveShopPrice, type WorkshopPriceMap } from '@/lib/apl-pricing'
import { KHAC_CATEGORY } from '@/lib/work-catalog'

// Đơn giá khoán theo CHỦNG LOẠI + fallback "Khác" (chốt nghiệp vụ 2026-08):
//  • Hàn kết cấu ≠ Hàn chi tiết; cùng chủng loại ở ITEM A ≠ ITEM B.
//  • Mọi chủng loại LẠ (ngoài danh mục) trong (ITEM × Xưởng) ăn MỘT giá "Khác" của item đó.
describe('resolveShopPrice — đơn giá theo chủng loại + fallback Khác', () => {
  const T = 'XHAN'
  const map: WorkshopPriceMap = new Map([
    [shopKey('A', T, 'H', 'KC'), 1000], // Hàn kết cấu, item A
    [shopKey('A', T, 'H', 'KK'), 1200], // Hàn khung kiện, item A
    [shopKey('A', T, '', KHAC_CATEGORY), 2000], // giá "Khác" của item A
    [shopKey('B', T, 'H', 'KC'), 1500], // Hàn kết cấu, item B (khác A)
    [shopKey('B', T, '', KHAC_CATEGORY), 2500], // giá "Khác" của item B
    [shopKey('C', T, '', ''), 800],     // item C: lệnh nguyên khối
  ])

  it('chủng loại có giá riêng → dùng đúng giá của nó', () => {
    expect(resolveShopPrice(map, 'A', T, 'H', 'KC')).toBe(1000)
    expect(resolveShopPrice(map, 'A', T, 'H', 'KK')).toBe(1200)
  })

  it('cùng chủng loại nhưng khác ITEM → giá khác nhau', () => {
    expect(resolveShopPrice(map, 'A', T, 'H', 'KC')).toBe(1000)
    expect(resolveShopPrice(map, 'B', T, 'H', 'KC')).toBe(1500)
  })

  it('chủng loại TRONG danh mục nhưng chưa đặt giá → null (thiếu giá), KHÔNG ăn giá Khác', () => {
    // TB (Thiết bị) thuộc công đoạn Hàn, chưa đặt giá → phải null dù item A có giá Khác.
    expect(resolveShopPrice(map, 'A', T, 'H', 'TB')).toBeNull()
  })

  it('chủng loại LẠ (ngoài danh mục) → ăn giá Khác của đúng ITEM đó', () => {
    // "Hàn thép đen" (mã lạ) trong công đoạn H → giá Khác của item.
    expect(resolveShopPrice(map, 'A', T, 'H', 'THEPDEN')).toBe(2000)
    expect(resolveShopPrice(map, 'B', T, 'H', 'THEPDEN')).toBe(2500)
  })

  it('chủng loại lạ nhưng ITEM không có giá Khác → null', () => {
    expect(resolveShopPrice(map, 'C', T, 'H', 'THEPDEN')).toBeNull()
  })

  it('lệnh nguyên khối (không stage/chủng loại) → dùng giá lệnh, KHÔNG fallback Khác', () => {
    expect(resolveShopPrice(map, 'C', T, '', '')).toBe(800)
    // item A không có giá nguyên khối → null (không mượn giá Khác)
    expect(resolveShopPrice(map, 'A', T, '', '')).toBeNull()
  })

  it('shopKey ổn định 4 phần', () => {
    expect(shopKey('A', 'XHAN', 'H', 'KC')).toBe('A::XHAN::H::KC')
    expect(shopKey('A', null, '', '')).toBe('A::::::')
  })
})
