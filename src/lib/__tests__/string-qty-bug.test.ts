import { describe, it, expect } from 'vitest'
import { toQty, toQtyOrNull } from '@/lib/pr-normalizer'
import { computeQuoteCoverage, type PrItem } from '@/lib/quote-parser'

// Dòng THẬT trên prod (26-WNC-I-109, task "Thương mại tìm nhà cung cấp"):
// số lưu dạng CHUỖI → trước đây bị `typeof === 'number'` bỏ qua IM LẶNG.
const MUI_KHOAN = {
  code: '', name: 'Mũi khoan chuôi côn F51', spec: '', unit: 'cái',
  quantity: '1', neededQty: '1', availableQty: 0, needToBuyQty: '1',
} as unknown as PrItem

const THEP_BINH_THUONG = {
  stt: 'I109-VTC01-001', description: 'Tôn tấm', unit: 'm2',
  quantity: 1.5, needToBuyQty: 1.5,
} as unknown as PrItem

describe('BUG: số lưu dạng chuỗi trong resultData', () => {
  describe('toQty — ép kiểu an toàn', () => {
    it.each([
      ['số thường', 1.5, 1.5],
      ['chuỗi số', '1', 1],
      ['chuỗi thập phân', '0.175', 0.175],
      ['phân cách nghìn kiểu Anh-Mỹ', '1,500', 1500],
      ['phân cách nghìn + thập phân', '12,345.67', 12345.67],
    ])('%s: %s → %s', (_l, input, expected) => {
      expect(toQty(input)).toBe(expected)
    })

    it('AN TOÀN: "1,5" (tiếng Việt = 1.5) KHÔNG bị xoá phẩy thành 15', () => {
      // Nhập nhằng → từ chối (null/0), thà bỏ còn hơn đặt mua thừa 10 lần
      expect(toQtyOrNull('1,5')).toBeNull()
      expect(toQty('1,5')).toBe(0)
      expect(toQty('1,5')).not.toBe(15)
    })

    it.each([[null], [undefined], [''], ['abc'], [{}], [NaN], [Infinity]])(
      'giá trị không hợp lệ %s → 0', (v) => { expect(toQty(v)).toBe(0) },
    )
  })

  describe('quote-parser: dòng số-chuỗi KHÔNG còn bị loại khỏi ma trận báo giá', () => {
    it('"Mũi khoan" (needToBuyQty="1") được tính vào coverage', () => {
      const cov = computeQuoteCoverage([THEP_BINH_THUONG, MUI_KHOAN], [])
      // Trước fix: chỉ 1 (dòng số-chuỗi bị filter văng) → R07 không thấy để hỏi giá
      expect(cov.totalNeedToBuy).toBe(2)
      expect(cov.missingItems.map(m => m.description)).toContain('Mũi khoan chuôi côn F51')
    })

    it('dòng needToBuyQty = "0" (chuỗi) → vẫn loại đúng (đủ kho)', () => {
      const duKho = { ...MUI_KHOAN, needToBuyQty: '0' } as unknown as PrItem
      expect(computeQuoteCoverage([duKho], []).totalNeedToBuy).toBe(0)
    })
  })

  describe('REGRESSION: needToBuyQty = 0 KHÔNG được rơi xuống fallback quantity', () => {
    // Đủ kho (needToBuyQty=0) mà lùi về quantity=10 → vật tư đã có kho lại lọt vào
    // file báo giá / PO. Có needToBuyQty thì dùng luôn, KỂ CẢ 0.
    it('exportQuoteTemplate LOẠI dòng đủ kho (needToBuyQty=0, quantity=10)', async () => {
      const { exportQuoteTemplate } = await import('@/lib/quote-template-export')
      const duKho = { stt: 'A1', description: 'Đã đủ kho', unit: 'm', quantity: 10, needToBuyQty: 0 } as unknown as PrItem
      const canMua = { stt: 'A2', description: 'Cần mua', unit: 'm', quantity: 10, needToBuyQty: 4 } as unknown as PrItem
      const wb = exportQuoteTemplate([duKho, canMua])
      const csv = Object.values(wb.Sheets).map(s => JSON.stringify(s)).join(' ')
      expect(csv).toContain('Cần mua')
      expect(csv).not.toContain('Đã đủ kho')
    })

    it('VẮNG needToBuyQty → mới lùi về quantity', () => {
      const vangNeed = { stt: 'A3', description: 'Không có needToBuyQty', unit: 'm', quantity: 7 } as unknown as PrItem
      // computeQuoteCoverage yêu cầu needToBuyQty > 0 nên dòng này không tính; kiểm qua toQty trực tiếp
      expect(toQtyOrNull(vangNeed.needToBuyQty)).toBeNull()
      expect(toQty(vangNeed.quantity)).toBe(7)
    })
  })
})
