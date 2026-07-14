import { describe, it, expect, vi } from 'vitest'
import { normalizePrLines, hasPrData, PR_RESULT_KEYS } from '@/lib/pr-normalizer'

// ══════════════════════════════════════════════════════════════
// FIXTURE LẤY NGUYÊN VĂN TỪ PROD (08/07/2026) — không bịa.
// Lưu ý: trên prod mọi key đều DOUBLE-ENCODED (chuỗi chứa JSON).
// ══════════════════════════════════════════════════════════════

/** Shape A — thép, có materialId (task P2.1 dự án I-109) */
const THEP_CO_MATERIAL = {
  stt: 'I109-VTC01-002', unit: 'm2', grade: 'SS400', weight: 13.56,
  profile: 'PL2x1200x720', category: 'OTHER', quantity: 0.864, neededQty: 0.864,
  stockUnit: 'm2', materialId: 'dffac071-03fd-4d85-b75b-2e0768afac3d',
  unitWeight: 15.7, description: 'Tôn tấm', availableQty: 0.689,
  categoryName: 'Main-Material /  Vật tư chính thép đen',
  needToBuyQty: 0.175, requiredDate: '2026-07-20',
  stockUnitMismatch: false, stockConvertedFromKg: false,
}

/** Shape A — thép, materialId VẮNG MẶT (chính là ca gây chặn cứng schema) */
const THEP_KHONG_MATERIAL = {
  stt: 'I109-VTC01-001', unit: 'm2', grade: 'SS400', weight: 11.78,
  profile: 'PL1x1200x1250', category: 'OTHER', quantity: 1.5, neededQty: 1.5,
  stockUnit: 'm2', unitWeight: 7.85, description: 'Tôn tấm', availableQty: 0,
  categoryName: 'Main-Material /  Vật tư chính thép đen',
  needToBuyQty: 1.5, requiredDate: '2026-07-15',
  stockUnitMismatch: false, stockConvertedFromKg: false,
}

/** Shape B — tiêu hao: task "PR dây hàn" của Trịnh Hữu Hưng (26-WNC-I-112) */
const DAY_HAN = [
  { stt: '1', description: 'Vật liệu hàn E71T-1C, size 1.2mm', spec: '', unit: 'kg', quantity: 1500, weight: 1500, category: 'weld' },
  { stt: '2', description: 'Vật liệu hàn ER70S6, size 0.8mm', spec: '', unit: 'kg', quantity: 50, weight: 50, category: 'weld' },
]

/** Shape B — sơn (paintPrItems, P2.2) */
const SON = [
  { stt: '1', description: 'International - Interzinc 52', spec: 'EPA 142/177 \r\nGrey', unit: 'litre', quantity: 285, weight: 0, category: 'paint' },
  { stt: '2', description: 'International - Interguard 475HS', spec: 'EVA010 White', unit: 'litre', quantity: 205, weight: 0, category: 'paint' },
]

/** Shape C — nhãn ở `name`, SỐ LƯU DẠNG CHUỖI (nằm lẫn trong key bomPr) */
const SHAPE_NAME = {
  code: '', name: 'Mũi khoan chuôi côn F51', spec: '', unit: 'cái',
  quantity: '1', neededQty: '1', stockUnit: 'cái', availableQty: 0,
  needToBuyQty: '1', stockUnitMismatch: false, stockConvertedFromKg: false,
}

/** prod lưu chuỗi JSON, không phải mảng */
const enc = (v: unknown) => JSON.stringify(v)

describe('pr-normalizer', () => {
  describe('phủ đủ 6 key', () => {
    it.each(PR_RESULT_KEYS)('đọc được key "%s"', (key) => {
      const lines = normalizePrLines({ [key]: enc([THEP_CO_MATERIAL]) })
      expect(lines).toHaveLength(1)
      expect(lines[0].itemCode).toBe('I109-VTC01-002')
    })

    it('gộp nhiều key trong cùng một task', () => {
      const lines = normalizePrLines({
        bomPrItems: enc([THEP_CO_MATERIAL]),
        weldData: enc(DAY_HAN),
        paintPrItems: enc(SON),
      })
      expect(lines).toHaveLength(5) // 1 thép + 2 hàn + 2 sơn
    })
  })

  describe('double-encoded (chuỗi chứa JSON) — ca thực tế trên prod', () => {
    it('parse được chuỗi JSON', () => {
      expect(normalizePrLines({ weldData: enc(DAY_HAN) })).toHaveLength(2)
    })
    it('vẫn nhận mảng thuần (phòng khi shape đổi về jsonb)', () => {
      expect(normalizePrLines({ weldData: DAY_HAN })).toHaveLength(2)
    })
  })

  describe('không bao giờ throw', () => {
    it('JSON hỏng → bỏ qua key đó, không throw', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const lines = normalizePrLines({ bomPr: '{"hỏng": ', weldData: enc(DAY_HAN) })
      expect(lines).toHaveLength(2) // key hỏng bị bỏ, key lành vẫn chạy
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
    it.each([
      ['null', null], ['undefined', undefined], ['chuỗi', 'abc'],
      ['số', 123], ['mảng', []], ['object rỗng', {}],
    ])('resultData = %s → []', (_label, input) => {
      expect(normalizePrLines(input)).toEqual([])
    })
    it('mảng rỗng → []', () => {
      expect(normalizePrLines({ bomPrItems: enc([]) })).toEqual([])
    })
    it('key có giá trị rác (số/bool/object) → []', () => {
      expect(normalizePrLines({ bomPr: 42 })).toEqual([])
      expect(normalizePrLines({ bomPr: enc({ khong: 'phai mang' }) })).toEqual([])
    })
    it('phần tử không phải object → bỏ', () => {
      expect(normalizePrLines({ bomPr: enc([null, 'x', 5, THEP_CO_MATERIAL]) })).toHaveLength(1)
    })
  })

  describe('lọc dòng không hợp lệ', () => {
    it('thiếu quantity → bỏ', () => {
      expect(normalizePrLines({ bomPr: enc([{ stt: 'X-1', description: 'Thiếu qty' }]) })).toEqual([])
    })
    it('quantity <= 0 → bỏ (dòng tiêu đề mục)', () => {
      const header = { stt: 'I104-VDK', description: 'Pakage-Material / Vật tư đóng kiện', unit: '', quantity: 0 }
      expect(normalizePrLines({ bomPr: enc([header]) })).toEqual([])
    })
    it('needToBuyQty = 0 (đủ kho) → bỏ, KHÔNG đề nghị mua', () => {
      const duKho = { ...THEP_CO_MATERIAL, quantity: 10, availableQty: 10, needToBuyQty: 0 }
      expect(normalizePrLines({ bomPrItems: enc([duKho]) })).toEqual([])
    })
    it('thiếu cả itemCode lẫn description → bỏ', () => {
      expect(normalizePrLines({ bomPr: enc([{ stt: '1', quantity: 5 }]) })).toEqual([])
    })
  })

  describe('số lượng = needToBuyQty (đã trừ tồn kho), giống create-po', () => {
    it('có needToBuyQty → dùng needToBuyQty, KHÔNG dùng quantity', () => {
      const [l] = normalizePrLines({ bomPrItems: enc([THEP_CO_MATERIAL]) })
      expect(l.quantity).toBe(0.175) // không phải 0.864
    })
    it('không có needToBuyQty (shape tiêu hao) → dùng quantity', () => {
      const [l] = normalizePrLines({ weldData: enc(DAY_HAN) })
      expect(l.quantity).toBe(1500)
    })
    it('ép kiểu số lưu dạng CHUỖI', () => {
      const [l] = normalizePrLines({ bomPr: enc([SHAPE_NAME]) })
      expect(l.quantity).toBe(1)
      expect(typeof l.quantity).toBe('number')
    })
  })

  describe('shape-driven, KHÔNG key-driven (key bomPr trên prod chứa lẫn 3 shape)', () => {
    it('một key bomPr chứa cả thép + hàn/sơn + shape name → map đúng từng dòng', () => {
      const lines = normalizePrLines({ bomPr: enc([THEP_CO_MATERIAL, ...DAY_HAN, SHAPE_NAME]) })
      expect(lines).toHaveLength(4)
      expect(lines[0].profile).toBe('PL2x1200x720')  // thép giữ profile
      expect(lines[1].profile).toBeUndefined()        // tiêu hao không có profile
      expect(lines[3].description).toBe('Mũi khoan chuôi côn F51') // shape C lấy từ `name`
    })
  })

  describe('itemCode', () => {
    it('shape thép: stt là MÃ → dùng làm itemCode', () => {
      expect(normalizePrLines({ bomPrItems: enc([THEP_CO_MATERIAL]) })[0].itemCode).toBe('I109-VTC01-002')
    })
    it('shape tiêu hao: stt="1" chỉ là SỐ THỨ TỰ → KHÔNG dùng làm itemCode', () => {
      const lines = normalizePrLines({ weldData: enc(DAY_HAN) })
      expect(lines[0].itemCode).toBeUndefined()
      expect(lines[1].itemCode).toBeUndefined()
    })
    it('ưu tiên canonicalCode > code > provisionalCode > stt', () => {
      const it1 = { ...THEP_CO_MATERIAL, canonicalCode: 'CANON-1', code: 'C-1', provisionalCode: 'P-1' }
      expect(normalizePrLines({ bomPr: enc([it1]) })[0].itemCode).toBe('CANON-1')
      const it2 = { ...THEP_CO_MATERIAL, code: 'C-1', provisionalCode: 'P-1' }
      expect(normalizePrLines({ bomPr: enc([it2]) })[0].itemCode).toBe('C-1')
    })
  })

  describe('materialId — lý do phải nới nullable ở schema', () => {
    it('có materialId → giữ nguyên', () => {
      expect(normalizePrLines({ bomPrItems: enc([THEP_CO_MATERIAL]) })[0].materialId)
        .toBe('dffac071-03fd-4d85-b75b-2e0768afac3d')
    })
    it('KHÔNG có materialId → null (1331/3202 dòng thép trên prod rơi vào ca này)', () => {
      expect(normalizePrLines({ bomPrItems: enc([THEP_KHONG_MATERIAL]) })[0].materialId).toBeNull()
    })
    it('dây hàn E71T-1C → materialId null (chưa có bản ghi Material)', () => {
      expect(normalizePrLines({ weldData: enc(DAY_HAN) })[0].materialId).toBeNull()
    })
  })

  describe('các field còn lại', () => {
    it('snapshot thép: profile/grade/unit/requiredDate/notes', () => {
      const [l] = normalizePrLines({ bomPrItems: enc([{ ...THEP_CO_MATERIAL, remarks: 'ghi chú BOM' }]) })
      expect(l.profile).toBe('PL2x1200x720')
      expect(l.grade).toBe('SS400')
      expect(l.unit).toBe('m2')
      expect(l.requiredDate).toBeInstanceOf(Date)
      expect(l.requiredDate?.toISOString().slice(0, 10)).toBe('2026-07-20')
      expect(l.notes).toBe('ghi chú BOM')
    })
    it('tiêu hao: spec → notes; requiredDate vắng → null', () => {
      const [l] = normalizePrLines({ paintPrItems: enc(SON) })
      expect(l.notes).toBe('EPA 142/177 \r\nGrey')
      expect(l.requiredDate).toBeNull()
      expect(l.unit).toBe('litre')
    })
    it('requiredDate rác → null, không throw', () => {
      const [l] = normalizePrLines({ bomPr: enc([{ ...THEP_CO_MATERIAL, requiredDate: 'khong-phai-ngay' }]) })
      expect(l.requiredDate).toBeNull()
    })
  })

  describe('supplierQuotes CỐ TÌNH bị loại (là báo giá, không phải nhu cầu mua)', () => {
    it('chỉ có supplierQuotes → [] (tránh nhân đôi số lượng)', () => {
      const quotes = enc([{ vendorId: 'v1', code: 'X', description: 'Thép', quantity: 10, unitPrice: 5000 }])
      expect(normalizePrLines({ supplierQuotes: quotes })).toEqual([])
    })
    it('có cả bomPr + supplierQuotes → chỉ đếm bomPr', () => {
      const quotes = enc([{ vendorId: 'v1', description: 'Tôn tấm', quantity: 99, unitPrice: 5000 }])
      const lines = normalizePrLines({ bomPrItems: enc([THEP_CO_MATERIAL]), supplierQuotes: quotes })
      expect(lines).toHaveLength(1)
      expect(lines[0].quantity).toBe(0.175)
    })
  })

  describe('hasPrData', () => {
    it('task "PR dây hàn" → true', () => {
      expect(hasPrData({ weldData: enc(DAY_HAN), templateType: 'x' })).toBe(true)
    })
    it('task chỉ có briefing → false', () => {
      expect(hasPrData({ briefing: 'nội dung giao ban' })).toBe(false)
    })
    it('task có key PR nhưng mọi dòng đủ kho → false', () => {
      const duKho = { ...THEP_CO_MATERIAL, needToBuyQty: 0 }
      expect(hasPrData({ bomPrItems: enc([duKho]) })).toBe(false)
    })
  })
})
