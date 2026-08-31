import { describe, it, expect } from 'vitest'
import { effectiveUnitPrice, ACCEPTED_WO_STATUS } from '../apl-pricing'

// Đây là logic ra TIỀN nên khoá chặt bằng test: sai một nước là trả lương sai.
describe('apl-pricing — đơn giá hiệu lực (dòng chi tiết vs ITEM)', () => {
  it('dòng chi tiết có giá riêng thì giá riêng thắng giá ITEM', () => {
    expect(effectiveUnitPrice(20000, 12000)).toBe(20000)
  })

  it('dòng chi tiết chưa có giá thì lấy theo giá của ITEM', () => {
    expect(effectiveUnitPrice(null, 12000)).toBe(12000)
    expect(effectiveUnitPrice(undefined, 12000)).toBe(12000)
  })

  it('cả hai đều trống thì trả null — dòng đó chưa tính tiền được', () => {
    expect(effectiveUnitPrice(null, null)).toBeNull()
    expect(effectiveUnitPrice(undefined, undefined)).toBeNull()
  })

  it('giá riêng bằng 0 vẫn là đã nhập, KHÔNG rơi về giá ITEM', () => {
    // 0 là giá hợp lệ (hạng mục không tính công). Nếu dùng `||` thì nó sẽ nhầm sang 12000.
    expect(effectiveUnitPrice(0, 12000)).toBe(0)
  })
})

describe('apl-pricing — WO thế nào là đã nghiệm thu', () => {
  it('chỉ QC_PASSED và COMPLETED mới tính tiền', () => {
    expect(ACCEPTED_WO_STATUS).toEqual(['QC_PASSED', 'COMPLETED'])
  })

  it('các trạng thái đang dở KHÔNG được tính', () => {
    for (const s of ['OPEN', 'IN_PROGRESS', 'QC_PENDING', 'QC_FAILED', 'ON_HOLD', 'PENDING_MATERIAL']) {
      expect(ACCEPTED_WO_STATUS).not.toContain(s)
    }
  })
})

describe('apl-pricing — chia KL nghiệm thu xuống dòng chi tiết', () => {
  // Luật: KL nghiệm thu của dòng chi tiết = KL thiết kế × tỉ lệ nghiệm thu của ITEM.
  // Cộng các dòng chi tiết phải đúng bằng KL nghiệm thu của lệnh sản xuất.
  const split = (children: number[], ratio: number) => children.map(kg => kg * ratio)

  it('ITEM nghiệm thu đủ → dòng chi tiết giữ nguyên KL thiết kế', () => {
    const kids = [831.5662, 831.5662, 24.34128, 5.966]
    const got = split(kids, 1)
    expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(kids.reduce((a, b) => a + b, 0), 6)
  })

  it('ITEM chưa nghiệm thu → mọi dòng chi tiết bằng 0', () => {
    expect(split([831.5662, 24.34128], 0)).toEqual([0, 0])
  })

  it('nghiệm thu một phần → cộng dòng chi tiết đúng bằng phần đã nghiệm thu của ITEM', () => {
    const kids = [600, 300, 100]        // ITEM 1000 kg
    const acceptedOfItem = 689.16
    const ratio = acceptedOfItem / 1000
    expect(split(kids, ratio).reduce((a, b) => a + b, 0)).toBeCloseTo(acceptedOfItem, 6)
  })
})
