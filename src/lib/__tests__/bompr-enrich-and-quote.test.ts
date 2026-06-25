import { describe, it, expect } from 'vitest'
import { matchQuoteLinesToPr, type QuoteLine, type PrItem } from '../quote-parser'

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
