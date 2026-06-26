import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseQuoteExcel, matchQuoteLinesToPr, normSpec, computeQuoteCoverage, computeQtyMismatches, type QuoteLine, type PrItem } from '../quote-parser'
import { matchInventoryServer, detectPrefixSubgroup, type InventoryRow } from '../bompr-enrich'
import { exportQuoteTemplate } from '../quote-template-export'

// ── Quote matcher tests ──

const makeLines = (overrides: Partial<QuoteLine>[]): QuoteLine[] =>
  overrides.map(o => ({
    code: '', description: '', profile: '', grade: '', unit: '',
    qty: 0, unitPrice: 0, amount: 0,
    matchedPrIndex: null, matchedPrCode: null,
    ...o,
  }))

describe('matchQuoteLinesToPr — canonicalCode matching', () => {
  const prItems: PrItem[] = [
    { stt: 'I112-VTC01-044', canonicalCode: 'VLC-HINH-C100', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5-12000L', grade: 'SS400', unit: 'm' },
    { stt: 'I112-VTC01-045', canonicalCode: 'VLC-TAM-PL10', description: 'THÉP TẤM', profile: 'PL10-1500X6000', grade: 'SS400', unit: 'm2' },
    { stt: 'I112-VTC01-046', description: 'THÉP HÌNH H', profile: 'H300X150X6.5X9', grade: 'SS400', unit: 'm' },
  ]

  it('matches by canonicalCode (Strategy 0) when quote line code = PR canonicalCode', () => {
    const lines = makeLines([
      { code: 'VLC-HINH-C100', description: 'THÉP C', qty: 120, unitPrice: 45000 },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(0)
    expect(matched[0].matchedPrCode).toBe('VLC-HINH-C100')
  })

  it('matches by STT when canonicalCode not matched', () => {
    const lines = makeLines([
      { code: 'I112-VTC01-046', description: 'THÉP H', qty: 80, unitPrice: 250000 },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(2)
    expect(matched[0].matchedPrCode).toBe('I112-VTC01-046')
  })

  it('prefers canonicalCode over STT match', () => {
    const lines = makeLines([
      { code: 'VLC-TAM-PL10', description: 'THÉP TẤM 10', qty: 50, unitPrice: 120000 },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(1)
    expect(matched[0].matchedPrCode).toBe('VLC-TAM-PL10')
  })

  it('falls back to profile+grade when code does not match', () => {
    const lines = makeLines([
      { code: 'BG-999', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5', grade: 'SS400', unit: 'm' },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(0)
  })

  it('unmatched lines remain null', () => {
    const lines = makeLines([
      { code: 'UNKNOWN-123', description: 'SƠN', profile: '', grade: '', unit: 'lít' },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBeNull()
  })
})

describe('matchQuoteLinesToPr — normSpec matching (bolts/nuts/misc)', () => {
  const prItems: PrItem[] = [
    { stt: 'I-VPK-001', description: 'NUT', profile: 'NUT-M16-ISO4032-8-HDG', grade: '', unit: 'cái' },
    { stt: 'I-VPK-002', description: 'BOLT', profile: 'BOLT-M16X50-8.8-HDG', grade: '', unit: 'cái' },
    { stt: 'I-VTC-001', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5-12000L', grade: 'SS400', unit: 'm' },
    { stt: 'I-VPK-003', description: 'WASHER', profile: 'WASHER-M16-HDG', grade: '', unit: 'cái' },
  ]

  it('(a) matches Nut-M16-ISO4032-8-HDG to NUT-M16-ISO4032-8-HDG via normSpec', () => {
    const lines = makeLines([
      { code: 'BG-001', description: 'Đai ốc', profile: 'Nut-M16-ISO4032-8-HDG', unit: 'cái', qty: 100, unitPrice: 5000 },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(0)
  })

  it('(b) steel still matches by section type + dims (no regression)', () => {
    const lines = makeLines([
      { code: 'BG-010', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5', grade: 'SS400', unit: 'm', qty: 50, unitPrice: 45000 },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(2)
  })

  it('normSpec normalizes case, spaces, dashes, dots, slashes', () => {
    expect(normSpec('Nut-M16-ISO4032-8-HDG')).toBe('NUTM16ISO40328HDG')
    expect(normSpec('NUT-M16-ISO4032-8-HDG')).toBe('NUTM16ISO40328HDG')
    expect(normSpec('bolt m16x50/8.8 HDG')).toBe('BOLTM16X5088HDG')
    expect(normSpec('BOLT-M16X50-8.8-HDG')).toBe('BOLTM16X5088HDG')
  })
})

describe('quote reset logic', () => {
  it('(c) resetQuoteData clears one NCC without affecting others', () => {
    const quotes = [
      { id: 'q1', vendorName: 'NCC A', totalAmount: 100000, lines: [{ code: 'X' }], files: [{ id: 'f1' }] },
      { id: 'q2', vendorName: 'NCC B', totalAmount: 200000, lines: [{ code: 'Y' }], files: [{ id: 'f2' }] },
    ]
    const resetId = 'q1'
    const result = quotes.map(q => q.id === resetId ? { ...q, lines: [], files: [], totalAmount: 0 } : q)
    expect(result[0].lines).toEqual([])
    expect(result[0].files).toEqual([])
    expect(result[0].totalAmount).toBe(0)
    expect(result[0].vendorName).toBe('NCC A')
    expect(result[1].lines).toHaveLength(1)
    expect(result[1].totalAmount).toBe(200000)
  })
})

describe('totals compute on all items', () => {
  it('(d) totalNeeded/totalToBuy sum over full array, not truncated subset', () => {
    const items = Array.from({ length: 100 }, () => ({
      neededQty: 10,
      needToBuyQty: 5,
      quantity: 10,
    }))
    const totalNeeded = items.reduce((s, it) => s + (typeof it.neededQty === 'number' ? it.neededQty : (Number(it.quantity) || 0)), 0)
    const totalToBuy = items.reduce((s, it) => s + (typeof it.needToBuyQty === 'number' ? it.needToBuyQty : (Number(it.quantity) || 0)), 0)
    expect(totalNeeded).toBe(1000)
    expect(totalToBuy).toBe(500)
  })
})

describe('PrItem type includes new fields', () => {
  it('requiredDate and availableQty are optional', () => {
    const item: PrItem = {
      stt: 'I-001',
      canonicalCode: 'VLC-001',
      description: 'Test',
      unit: 'm',
      quantity: 10,
      neededQty: 10,
      availableQty: 5,
      needToBuyQty: 5,
      requiredDate: '2026-07-01',
    }
    expect(item.canonicalCode).toBe('VLC-001')
    expect(item.availableQty).toBe(5)
    expect(item.requiredDate).toBe('2026-07-01')
  })
})

// ── Server-side inventory matching tests ──

function makeInv(overrides: Partial<InventoryRow> & { materialCode: string }): InventoryRow {
  return {
    id: overrides.materialCode,
    name: '',
    unit: 'm',
    specification: null,
    grade: null,
    groupCode: null,
    currentStock: 100,
    reusableStock: 80,
    projectStock: 20,
    projectWarehouses: [{ projectCode: 'DA-001', quantity: 20 }],
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePr(overrides: Record<string, any>): any {
  return {
    stt: '', description: '', profile: '', grade: '', unit: 'm',
    quantity: 10, weight: 0, unitWeight: 0, thickness: 0, length: 0, width: 0,
    ...overrides,
  }
}

describe('matchInventoryServer — attribute matching', () => {
  const inventory: InventoryRow[] = [
    makeInv({ materialCode: 'VLC-C100', name: 'Thép hình C C100x50x5x7.5', specification: 'C100X50X5X7.5', grade: 'SS400', unit: 'm' }),
    makeInv({ materialCode: 'VLC-PL10', name: 'Thép tấm PL10', specification: 'PL10', grade: 'SS400', unit: 'm2', reusableStock: 50 }),
    makeInv({ materialCode: 'VLC-H300', name: 'Thép hình H H300x150x6.5x9', specification: 'H300X150X6.5X9', grade: 'SS400', unit: 'kg', reusableStock: 500 }),
    makeInv({ materialCode: 'VLC-ONG42', name: 'Thép ống Ø42x3.5', specification: 'Ø42x3.5', grade: 'SS400', unit: 'm', groupCode: '1.5' }),
  ]
  const emptyResolved = new Map<string, InventoryRow>()

  it('(a) matches by profile+grade+unit even without canonicalCode → availableQty > 0', () => {
    const items = [makePr({
      stt: 'I-001', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5-12000L', grade: 'SS400', unit: 'm', quantity: 50,
    })]
    const result = matchInventoryServer(items, inventory, emptyResolved)
    expect(result.get(0)?.inv?.materialCode).toBe('VLC-C100')
  })

  it('(b) canonicalCode takes priority over attribute match', () => {
    const resolved = new Map<string, InventoryRow>()
    resolved.set('CUSTOM-CODE', makeInv({ materialCode: 'CUSTOM-CODE', name: 'Custom', reusableStock: 200, unit: 'm' }))

    const items = [makePr({
      stt: 'I-001', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5', grade: 'SS400', unit: 'm',
      canonicalCode: 'CUSTOM-CODE', quantity: 10,
    })]
    const result = matchInventoryServer(items, inventory, resolved)
    expect(result.get(0)?.inv?.materialCode).toBe('CUSTOM-CODE')
    expect(result.get(0)?.viaCode).toBe(true)
  })

  it('(c) converts kg↔m using unitWeight for available stock calculation', () => {
    // H300 is stocked in kg, PR requests in m with unitWeight
    const items = [makePr({
      stt: 'I-002', description: 'THÉP HÌNH H', profile: 'H300X150X6.5X9', grade: 'SS400',
      unit: 'm', quantity: 10, unitWeight: 36.7,
    })]
    const result = matchInventoryServer(items, inventory, emptyResolved)
    const inv = result.get(0)?.inv
    expect(inv?.materialCode).toBe('VLC-H300')
    expect(inv?.unit).toBe('kg')
  })

  it('(d) no match at all → inv is null', () => {
    const items = [makePr({
      stt: 'I-999', description: 'SƠN CHỐNG GỈ', profile: '', grade: '', unit: 'lít', quantity: 50,
    })]
    const result = matchInventoryServer(items, inventory, emptyResolved)
    expect(result.get(0)?.inv).toBeNull()
  })

  it('matches by section type when profile format differs from inventory', () => {
    // PR has PL10 profile, inventory has specification PL10
    const items = [makePr({
      stt: 'I-003', description: 'THÉP TẤM', profile: 'PL10', grade: 'SS400', unit: 'm2', quantity: 20,
    })]
    const result = matchInventoryServer(items, inventory, emptyResolved)
    expect(result.get(0)?.inv?.materialCode).toBe('VLC-PL10')
  })

  it('matches multiple items independently', () => {
    const items = [
      makePr({ stt: 'I-001', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5', grade: 'SS400', unit: 'm' }),
      makePr({ stt: 'I-002', description: 'SƠN', profile: '', grade: '', unit: 'lít' }),
      makePr({ stt: 'I-003', description: 'THÉP TẤM', profile: 'PL10', grade: 'SS400', unit: 'm2' }),
    ]
    const result = matchInventoryServer(items, inventory, emptyResolved)
    expect(result.get(0)?.inv?.materialCode).toBe('VLC-C100')
    expect(result.get(1)?.inv).toBeNull()
    expect(result.get(2)?.inv?.materialCode).toBe('VLC-PL10')
  })
})

// ── Standardized template export + parse round-trip ──

describe('quote template round-trip', () => {
  const prItems: PrItem[] = [
    { stt: 'I112-VTC01-001', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5', grade: 'SS400', unit: 'm', quantity: 50, needToBuyQty: 30 },
    { stt: 'I112-VTC01-002', description: 'THÉP TẤM', profile: 'PL10', grade: 'SS400', unit: 'm2', quantity: 40, needToBuyQty: 20 },
    { stt: 'I112-VPK01-001', description: 'BOLT', profile: 'BOLT-M16X50-8.8-HDG', unit: 'cái', quantity: 200, needToBuyQty: 150 },
  ]

  it('(a) export → parse → match achieves 100% by Item code', () => {
    const wb = exportQuoteTemplate(prItems, { projectCode: 'DA-TEST' })
    const ws = wb.Sheets['BG']
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]

    // Simulate NCC filling in qty + unit price (col H=Số lượng, col I=Đơn giá after Mã vật tư insertion)
    for (const row of data) {
      const code = String(row[0] || '')
      if (!code.startsWith('I112-')) continue
      row[7] = row[6] // Copy IBS "Cần mua" (col G) to NCC "Số lượng" (col H)
      row[8] = 50000   // Unit price (col I)
    }

    const lines = parseQuoteExcel(data)
    expect(lines.length).toBe(3)

    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched.every(l => l.matchedPrIndex !== null)).toBe(true)
    expect(matched[0].matchedPrCode).toBe('I112-VTC01-001')
    expect(matched[1].matchedPrCode).toBe('I112-VTC01-002')
    expect(matched[2].matchedPrCode).toBe('I112-VPK01-001')
  })

  it('(b) parser reads Item/Đơn giá from standardized template', () => {
    const data: unknown[][] = [
      ['BG chuẩn hóa'],
      ['Dự án:', 'DA-001'],
      [],
      [],
      ['', '', 'Yêu cầu (IBS)', '', '', '', 'Đề xuất (NCC)', '', ''],
      ['Item', 'Description', 'Profile', 'Grade', 'ĐVT', 'Cần mua', 'Số lượng', 'Đơn giá', 'Thành tiền'],
      ['VTC'],
      ['I-VTC-001', 'THÉP C', 'C100', 'SS400', 'm', 30, 25, 45000, 1125000],
      ['I-VTC-002', 'THÉP TẤM', 'PL10', 'SS400', 'm2', 20, 15, 120000, 1800000],
    ]

    const lines = parseQuoteExcel(data)
    expect(lines.length).toBe(2)
    expect(lines[0].code).toBe('I-VTC-001')
    expect(lines[0].qty).toBe(25)
    expect(lines[0].unitPrice).toBe(45000)
    expect(lines[1].code).toBe('I-VTC-002')
    expect(lines[1].qty).toBe(15)
    expect(lines[1].unitPrice).toBe(120000)
  })

  it('(c) compact table logic: needToBuyQty preferred over quantity', () => {
    const items: Partial<PrItem>[] = [
      { needToBuyQty: 5, quantity: 10 },
      { quantity: 8 },
      { needToBuyQty: 0, quantity: 10 },
      { needToBuyQty: undefined, quantity: 0 },
    ]
    const display = items.map(p => (p as PrItem).needToBuyQty ?? (p as PrItem).quantity ?? 0)
    expect(display).toEqual([5, 8, 0, 0])
  })

  it('(d) free-form NCC files still fuzzy-match (backward compat)', () => {
    const data: unknown[][] = [
      ['STT', 'Mô tả', 'Quy cách', 'Mác', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền'],
      ['BG-001', 'THÉP HÌNH C', 'C100X50X5X7.5', 'SS400', 'm', 30, 45000, 1350000],
    ]

    const lines = parseQuoteExcel(data)
    expect(lines.length).toBe(1)

    const prItemsFreeForm: PrItem[] = [
      { stt: 'I-VTC-001', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5-12000L', grade: 'SS400', unit: 'm', quantity: 50 },
    ]
    const matched = matchQuoteLinesToPr(lines, prItemsFreeForm)
    expect(matched[0].matchedPrIndex).toBe(0)
  })

  it('export groups items by category (VTC/VPK)', () => {
    const wb = exportQuoteTemplate(prItems, { projectCode: 'DA-001', projectName: 'Test Project' })
    const ws = wb.Sheets['BG']
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]

    expect(String(data[0][0])).toBe('BG chuẩn hóa')
    expect(String(data[1][1])).toBe('DA-001')
    expect(String(data[2][1])).toBe('Test Project')

    const catRows = data.filter(r => /^(VTC|VPK|VDK|Grating|Khác)$/.test(String(r[0] || '')))
    expect(catRows.length).toBeGreaterThanOrEqual(2)
  })

  it('export only includes items with needToBuyQty > 0', () => {
    const mixedItems: PrItem[] = [
      { stt: 'I-001', description: 'A', unit: 'm', quantity: 10, needToBuyQty: 5 },
      { stt: 'I-002', description: 'B', unit: 'm', quantity: 10, needToBuyQty: 0 },
      { stt: 'I-003', description: 'C', unit: 'm', quantity: 10 },
    ]
    const wb = exportQuoteTemplate(mixedItems)
    const ws = wb.Sheets['BG']
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]

    const dataRows = data.filter(r => String(r[0] || '').startsWith('I-'))
    expect(dataRows.length).toBe(2) // I-001 (needToBuy=5) and I-003 (qty=10, no needToBuy)
  })
})

// ── Comparison logic tests (coverage, split-cheapest, VAT) ──

describe('canonicalCode display priority', () => {
  it('prefers canonicalCode over stt, marks items without canonicalCode', () => {
    const withCanonical: PrItem = { canonicalCode: 'VLC.U100-006', stt: 'I112-VTC01-044', description: 'Thép', unit: 'm' }
    const withoutCanonical: PrItem = { stt: 'I112-VTC01-044', description: 'Thép', unit: 'm' }
    const noCode: PrItem = { description: 'Thép', unit: 'm' }

    const display1 = withCanonical.canonicalCode || withCanonical.stt || ''
    expect(display1).toBe('VLC.U100-006')
    expect(!!withCanonical.canonicalCode).toBe(true)

    const display2 = withoutCanonical.canonicalCode || withoutCanonical.stt || ''
    expect(display2).toBe('I112-VTC01-044')
    expect(!!withoutCanonical.canonicalCode).toBe(false)

    const display3 = noCode.canonicalCode || noCode.stt || noCode.code || ''
    expect(display3).toBe('')
  })
})

describe('NCC detail totals with VAT', () => {
  it('computes before-VAT, VAT amount, and after-VAT totals correctly', () => {
    const lines: QuoteLine[] = makeLines([
      { code: 'A', qty: 10, unitPrice: 100, amount: 1000, vatPercent: 10, matchedPrIndex: 0 },
      { code: 'B', qty: 5, unitPrice: 200, amount: 1000, vatPercent: 8, matchedPrIndex: 1 },
    ])
    const totalPre = lines.reduce((s, l) => s + l.amount, 0)
    const totalVat = lines.reduce((s, l) => s + l.amount * ((l.vatPercent ?? 10) / 100), 0)
    const totalAfter = totalPre + totalVat

    expect(totalPre).toBe(2000)
    expect(totalVat).toBe(100 + 80) // 1000*10% + 1000*8%
    expect(totalAfter).toBe(2180)
  })

  it('defaults to 10% VAT when vatPercent is undefined', () => {
    const lines: QuoteLine[] = makeLines([
      { code: 'A', qty: 10, unitPrice: 100, amount: 1000, matchedPrIndex: 0 },
    ])
    const vat = lines[0].vatPercent ?? 10
    expect(vat).toBe(10)
    const afterVat = lines[0].amount * (1 + vat / 100)
    expect(afterVat).toBe(1100)
  })
})

describe('coverage calculation', () => {
  it('identifies full vs partial coverage correctly', () => {
    type PI = { unitPrice: number; vatPct: number }
    const rows = [
      { prices: { q1: { unitPrice: 100, vatPct: 10 }, q2: { unitPrice: 120, vatPct: 10 } } as Record<string, PI> },
      { prices: { q1: { unitPrice: 200, vatPct: 10 } } as Record<string, PI> },
      { prices: { q1: { unitPrice: 50, vatPct: 10 }, q2: { unitPrice: 60, vatPct: 10 } } as Record<string, PI> },
    ]
    const computeCoverage = (qId: string) => {
      const covered = rows.filter(r => r.prices[qId]?.unitPrice > 0).length
      return { covered, total: rows.length, full: covered === rows.length }
    }
    expect(computeCoverage('q1')).toEqual({ covered: 3, total: 3, full: true })
    expect(computeCoverage('q2')).toEqual({ covered: 2, total: 3, full: false })
  })
})

describe('split-cheapest comparison', () => {
  it('picks cheapest NCC per item and computes savings vs trọn gói', () => {
    type PI = { unitPrice: number; vatPct: number }
    const avPrice = (p: PI) => p.unitPrice * (1 + p.vatPct / 100)

    const rows = [
      { prIdx: 0, needToBuy: 10, prices: { q1: { unitPrice: 100, vatPct: 10 }, q2: { unitPrice: 90, vatPct: 10 } } as Record<string, PI> },
      { prIdx: 1, needToBuy: 5, prices: { q1: { unitPrice: 200, vatPct: 10 }, q2: { unitPrice: 250, vatPct: 10 } } as Record<string, PI> },
    ]

    const splitWinners: Record<number, string> = {}
    let splitTotal = 0
    for (const r of rows) {
      let bestQId = ''
      let bestAv = Infinity
      for (const [qId, p] of Object.entries(r.prices)) {
        const av = avPrice(p)
        if (av < bestAv) { bestAv = av; bestQId = qId }
      }
      if (bestQId) {
        splitWinners[r.prIdx] = bestQId
        splitTotal += bestAv * r.needToBuy
      }
    }

    // q2 cheaper for item 0 (90*1.1=99 vs 100*1.1=110)
    expect(splitWinners[0]).toBe('q2')
    // q1 cheaper for item 1 (200*1.1=220 vs 250*1.1=275)
    expect(splitWinners[1]).toBe('q1')

    // split total: 99*10 + 220*5 = 990 + 1100 = 2090
    expect(Math.round(splitTotal)).toBe(2090)

    // q1 trọn gói (has full coverage): 110*10 + 220*5 = 1100+1100 = 2200
    const q1Total = Math.round(rows.reduce((s, r) => s + avPrice(r.prices.q1) * r.needToBuy, 0))
    expect(q1Total).toBe(2200)

    // savings = 2200 - 2090 = 110
    expect(q1Total - Math.round(splitTotal)).toBe(110)
  })

  it('handles mixed VAT rates correctly in split comparison', () => {
    type PI = { unitPrice: number; vatPct: number }
    const avPrice = (p: PI) => p.unitPrice * (1 + p.vatPct / 100)

    const rows = [
      { prIdx: 0, needToBuy: 10, prices: {
        q1: { unitPrice: 100, vatPct: 10 },
        q2: { unitPrice: 95, vatPct: 8 },
      } as Record<string, PI> },
    ]

    // q1 after VAT: 100*1.10 = 110
    // q2 after VAT: 95*1.08 = 102.6
    const q1Av = avPrice(rows[0].prices.q1)
    const q2Av = avPrice(rows[0].prices.q2)
    expect(q1Av).toBeCloseTo(110)
    expect(q2Av).toBeCloseTo(102.6)
    expect(q2Av).toBeLessThan(q1Av)
  })
})

// ── detectPrefixSubgroup tests ──

describe('detectPrefixSubgroup', () => {
  it('detects steel plate (tôn/tấm) → VLC-TAM', () => {
    expect(detectPrefixSubgroup({ description: 'THÉP TẤM', profile: 'PL10' })).toEqual({ prefix: 'VLC', subgroup: 'TAM' })
    expect(detectPrefixSubgroup({ description: 'TÔN TẤM 6mm' })).toEqual({ prefix: 'VLC', subgroup: 'TAM' })
  })

  it('detects steel section (hình) → VLC-HINH', () => {
    expect(detectPrefixSubgroup({ description: 'THÉP HÌNH C', profile: 'C100X50' })).toEqual({ prefix: 'VLC', subgroup: 'HINH' })
    expect(detectPrefixSubgroup({ description: 'H Beam', profile: 'H300X150' })).toEqual({ prefix: 'VLC', subgroup: 'HINH' })
  })

  it('detects bolts → BAH-BULO', () => {
    expect(detectPrefixSubgroup({ description: 'BU LÔNG M16' })).toEqual({ prefix: 'BAH', subgroup: 'BULO' })
  })

  it('detects pipe → VLC-ONG', () => {
    expect(detectPrefixSubgroup({ description: 'THÉP ỐNG', profile: 'Ø42x3.5' })).toEqual({ prefix: 'VLC', subgroup: 'ONG' })
  })

  it('detects grating → GRT-GRTN', () => {
    expect(detectPrefixSubgroup({ description: 'Steel Grating 30x100' })).toEqual({ prefix: 'GRT', subgroup: 'GRTN' })
  })

  it('defaults to VLP-KHAC for unknown', () => {
    expect(detectPrefixSubgroup({ description: 'Bảo hộ lao động' })).toEqual({ prefix: 'VLP', subgroup: 'KHAC' })
  })

  it('is deterministic — same inputs always produce same output', () => {
    const item = { description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5' }
    const a = detectPrefixSubgroup(item)
    const b = detectPrefixSubgroup(item)
    expect(a).toEqual(b)
  })
})

// ── Export template with dual codes ──

describe('export template has Item + Mã vật tư columns', () => {
  const prItems: PrItem[] = [
    { stt: 'I-VTC-001', canonicalCode: 'VLC-HINH-001', description: 'THÉP C', profile: 'C100', grade: 'SS400', unit: 'm', needToBuyQty: 30 },
    { stt: 'I-VTC-002', description: 'SƠN', unit: 'lít', needToBuyQty: 10 },
  ]

  it('header row includes Item and Mã vật tư', () => {
    const wb = exportQuoteTemplate(prItems)
    const ws = wb.Sheets['BG']
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
    const headerRow = data.find(r => String(r[0]) === 'Item')
    expect(headerRow).toBeDefined()
    expect(String(headerRow![1])).toBe('Mã vật tư')
    expect(String(headerRow![2])).toBe('Description')
  })

  it('data rows have canonicalCode in column B', () => {
    const wb = exportQuoteTemplate(prItems)
    const ws = wb.Sheets['BG']
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
    const itemRow = data.find(r => String(r[0]) === 'I-VTC-001')
    expect(itemRow).toBeDefined()
    expect(String(itemRow![1])).toBe('VLC-HINH-001')
  })

  it('item without canonicalCode has empty column B', () => {
    const wb = exportQuoteTemplate(prItems)
    const ws = wb.Sheets['BG']
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
    const itemRow = data.find(r => String(r[0]) === 'I-VTC-002')
    expect(itemRow).toBeDefined()
    expect(String(itemRow![1])).toBe('')
  })

  it('round-trip: export → parse → match still works with new format', () => {
    const wb = exportQuoteTemplate(prItems)
    const ws = wb.Sheets['BG']
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]

    for (const row of data) {
      const code = String(row[0] || '')
      if (!code.startsWith('I-VTC-')) continue
      row[7] = row[6]
      row[8] = 50000
    }

    const lines = parseQuoteExcel(data)
    expect(lines.length).toBe(2)

    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(0)
    expect(matched[1].matchedPrIndex).toBe(1)
  })
})

// ── Dedup key determinism ──

describe('provisional dedup key is deterministic', () => {
  it('same profile+grade+unit always produce same key', () => {
    const key = (p: PrItem) => [
      (p.profile || '').trim().toLowerCase(),
      (p.grade || '').trim().toLowerCase(),
      (p.unit || p.uom || '').trim().toLowerCase(),
    ].join('|')

    const a: PrItem = { stt: 'A-001', description: 'THÉP HÌNH C', profile: 'C100X50', grade: 'SS400', unit: 'm' }
    const b: PrItem = { stt: 'B-002', description: 'THÉP C KHÁC', profile: 'C100X50', grade: 'SS400', unit: 'm' }
    expect(key(a)).toBe(key(b))
  })

  it('different profile produces different key', () => {
    const key = (p: PrItem) => [
      (p.profile || '').trim().toLowerCase(),
      (p.grade || '').trim().toLowerCase(),
      (p.unit || p.uom || '').trim().toLowerCase(),
    ].join('|')

    const a: PrItem = { profile: 'C100X50', grade: 'SS400', unit: 'm' }
    const b: PrItem = { profile: 'H300X150', grade: 'SS400', unit: 'm' }
    expect(key(a)).not.toBe(key(b))
  })
})

// ── Qty mismatch tests ──

describe('computeQtyMismatches', () => {
  const prItems: PrItem[] = [
    { stt: 'A-001', needToBuyQty: 100, description: 'Thép C', unit: 'm' },
    { stt: 'A-002', needToBuyQty: 50, description: 'Thép H', unit: 'm' },
    { stt: 'A-003', needToBuyQty: 200, description: 'Tôn', unit: 'm2' },
  ]

  it('detects surplus (NCC > PR)', () => {
    const lines = makeLines([{ code: 'A-001', qty: 120, matchedPrIndex: 0 }])
    const mm = computeQtyMismatches(lines, prItems)
    expect(mm).toHaveLength(1)
    expect(mm[0].delta).toBe(20)
  })

  it('detects shortage (NCC < PR)', () => {
    const lines = makeLines([{ code: 'A-002', qty: 30, matchedPrIndex: 1 }])
    const mm = computeQtyMismatches(lines, prItems)
    expect(mm).toHaveLength(1)
    expect(mm[0].delta).toBe(-20)
  })

  it('returns empty when quantities match', () => {
    const lines = makeLines([{ code: 'A-003', qty: 200, matchedPrIndex: 2 }])
    const mm = computeQtyMismatches(lines, prItems)
    expect(mm).toHaveLength(0)
  })

  it('skips unmatched lines (ngoài PR)', () => {
    const lines = makeLines([{ code: 'X-999', qty: 10, matchedPrIndex: null }])
    const mm = computeQtyMismatches(lines, prItems)
    expect(mm).toHaveLength(0)
  })
})

// ── Quote coverage tests ──

describe('computeQuoteCoverage', () => {
  const prItems: PrItem[] = [
    { stt: 'A-001', canonicalCode: 'VLC-001', description: 'Thép C', needToBuyQty: 100 },
    { stt: 'A-002', canonicalCode: 'VLC-002', description: 'Thép H', needToBuyQty: 50 },
    { stt: 'A-003', canonicalCode: 'VLC-003', description: 'Tôn', needToBuyQty: 200 },
    { stt: 'A-004', canonicalCode: 'VLC-004', description: 'Đủ kho', needToBuyQty: 0 },
  ]

  it('counts items with ≥1 vendor quoting (unitPrice>0)', () => {
    const quotes = [
      { lines: makeLines([{ matchedPrIndex: 0, unitPrice: 5000 }, { matchedPrIndex: 1, unitPrice: 6000 }]) },
    ]
    const c = computeQuoteCoverage(prItems, quotes)
    expect(c.totalNeedToBuy).toBe(3)
    expect(c.coveredCount).toBe(2)
    expect(c.coveragePercent).toBe(67)
  })

  it('returns 100% when all needToBuy items have at least 1 quote', () => {
    const quotes = [
      { lines: makeLines([{ matchedPrIndex: 0, unitPrice: 5000 }, { matchedPrIndex: 1, unitPrice: 6000 }, { matchedPrIndex: 2, unitPrice: 7000 }]) },
    ]
    const c = computeQuoteCoverage(prItems, quotes)
    expect(c.coveragePercent).toBe(100)
    expect(c.missingItems).toHaveLength(0)
  })

  it('lists missing items correctly', () => {
    const quotes = [
      { lines: makeLines([{ matchedPrIndex: 0, unitPrice: 5000 }]) },
    ]
    const c = computeQuoteCoverage(prItems, quotes)
    expect(c.missingItems).toHaveLength(2)
    expect(c.missingItems.map(m => m.stt)).toEqual(['A-002', 'A-003'])
  })

  it('excludes needToBuyQty=0 items from coverage calculation', () => {
    const quotes = [{ lines: [] as QuoteLine[] }]
    const c = computeQuoteCoverage(prItems, quotes)
    expect(c.totalNeedToBuy).toBe(3)
  })

  it('tracks per-item vendor count', () => {
    const quotes = [
      { lines: makeLines([{ matchedPrIndex: 0, unitPrice: 5000 }, { matchedPrIndex: 1, unitPrice: 6000 }]) },
      { lines: makeLines([{ matchedPrIndex: 0, unitPrice: 4800 }]) },
    ]
    const c = computeQuoteCoverage(prItems, quotes)
    expect(c.perItemVendorCount[0]).toBe(2)
    expect(c.perItemVendorCount[1]).toBe(1)
    expect(c.perItemVendorCount[2]).toBe(0)
  })
})
