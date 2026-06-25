import { describe, it, expect } from 'vitest'
import { matchQuoteLinesToPr, type QuoteLine, type PrItem } from '../quote-parser'
import { matchInventoryServer, type InventoryRow } from '../bompr-enrich'

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
