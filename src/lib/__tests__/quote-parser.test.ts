import { describe, it, expect } from 'vitest'
import { parseQuoteExcel, matchQuoteLinesToPr, type QuoteLine, type PrItem } from '../quote-parser'

describe('parseQuoteExcel', () => {
  it('parses standard BG layout with Vietnamese headers', () => {
    const data: unknown[][] = [
      // noise rows 0-16
      ...Array(17).fill([]),
      // row 17: header
      ['Item', 'Description', 'Profile', 'Grade', 'ĐVT', 'Số lượng', 'Đơn giá (VND)', 'Thành tiền'],
      // row 18: sub-header (should be skipped)
      ['', '', '', '', '', 'Q.ty', '', ''],
      // row 19: data
      ['I112-VTC01-044', 'THÉP HÌNH C', 'C100X50X5X7.5-12000L', 'SS400', 'm', 120, 45000, 5400000],
      ['I112-VTC01-045', 'THÉP TẤM', 'PL10-1500X6000', 'SS400', 'm2', 50, 120000, 6000000],
      ['I112-VTC01-046', 'THÉP HÌNH H', 'H300X150X6.5X9', 'SS400', 'm', 80, 250000, 20000000],
      // footer
      ['Total', '', '', '', '', '', '', 31400000],
    ]

    const lines = parseQuoteExcel(data)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({
      code: 'I112-VTC01-044',
      description: 'THÉP HÌNH C',
      profile: 'C100X50X5X7.5-12000L',
      grade: 'SS400',
      unit: 'm',
      qty: 120,
      unitPrice: 45000,
      amount: 5400000,
    })
    expect(lines[1].code).toBe('I112-VTC01-045')
    expect(lines[2].code).toBe('I112-VTC01-046')
  })

  it('parses English headers', () => {
    const data: unknown[][] = [
      ['Item', 'Description', 'Profile', 'Grade', 'Unit', 'Quantity', 'Unit Price', 'Amount'],
      ['A001', 'STEEL PLATE', 'PL12', 'A36', 'kg', 500, 25000, 12500000],
    ]
    const lines = parseQuoteExcel(data)
    expect(lines).toHaveLength(1)
    expect(lines[0].unitPrice).toBe(25000)
  })

  it('calculates amount from qty * unitPrice when amount column missing', () => {
    const data: unknown[][] = [
      ['STT', 'Tên vật tư', 'Đơn giá', 'SL'],
      ['001', 'Ống thép', 100000, 10],
    ]
    const lines = parseQuoteExcel(data)
    expect(lines).toHaveLength(1)
    expect(lines[0].amount).toBe(1000000)
  })

  it('skips category and total rows', () => {
    const data: unknown[][] = [
      ['Item', 'Description', 'Profile', 'Grade', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền'],
      ['VTC01', 'Vật tư chính thép đen', '', '', '', '', '', ''],
      ['I-001', 'THÉP C', 'C100', 'SS400', 'm', 10, 50000, 500000],
      ['Tổng', '', '', '', '', '', '', 500000],
    ]
    const lines = parseQuoteExcel(data)
    expect(lines).toHaveLength(1)
    expect(lines[0].code).toBe('I-001')
  })

  it('returns empty for no header', () => {
    const data: unknown[][] = [['foo', 'bar', 'baz']]
    expect(parseQuoteExcel(data)).toHaveLength(0)
  })
})

describe('matchQuoteLinesToPr', () => {
  const prItems: PrItem[] = [
    { stt: 'I112-VTC01-044', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5-12000L', grade: 'SS400', unit: 'm' },
    { stt: 'I112-VTC01-045', description: 'THÉP TẤM', profile: 'PL10-1500X6000', grade: 'SS400', unit: 'm2' },
    { stt: 'I112-VTC01-046', description: 'THÉP HÌNH H', profile: 'H300X150X6.5X9', grade: 'SS400', unit: 'm' },
  ]

  const makeLines = (overrides: Partial<QuoteLine>[]): QuoteLine[] =>
    overrides.map(o => ({
      code: '', description: '', profile: '', grade: '', unit: '',
      qty: 0, unitPrice: 0, amount: 0,
      matchedPrIndex: null, matchedPrCode: null,
      ...o,
    }))

  it('matches by exact code', () => {
    const lines = makeLines([
      { code: 'I112-VTC01-044', description: 'THÉP C', qty: 120, unitPrice: 45000 },
      { code: 'I112-VTC01-046', description: 'THÉP H', qty: 80, unitPrice: 250000 },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(0)
    expect(matched[0].matchedPrCode).toBe('I112-VTC01-044')
    expect(matched[1].matchedPrIndex).toBe(2)
    expect(matched[1].matchedPrCode).toBe('I112-VTC01-046')
  })

  it('matches by section type + dimensions when code differs', () => {
    const lines = makeLines([
      { code: 'BG-001', description: 'THÉP HÌNH C', profile: 'C100X50X5X7.5', grade: 'SS400', unit: 'm' },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(0)
  })

  it('marks unmatched lines with null', () => {
    const lines = makeLines([
      { code: 'BG-999', description: 'SƠN', profile: '', grade: '', unit: 'lít' },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBeNull()
    expect(matched[0].matchedPrCode).toBeNull()
  })

  it('does not match same PR item twice', () => {
    const lines = makeLines([
      { code: 'I112-VTC01-044', description: 'THÉP C', qty: 60 },
      { code: 'I112-VTC01-044', description: 'THÉP C', qty: 60 },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(0)
    expect(matched[1].matchedPrIndex).toBeNull()
  })

  it('matches by section type + dims ignoring grade as fallback', () => {
    const lines = makeLines([
      { code: 'X-001', description: 'THÉP HÌNH H', profile: 'H300X150X6.5X9', grade: 'A36', unit: 'm' },
    ])
    const matched = matchQuoteLinesToPr(lines, prItems)
    expect(matched[0].matchedPrIndex).toBe(2)
  })
})
