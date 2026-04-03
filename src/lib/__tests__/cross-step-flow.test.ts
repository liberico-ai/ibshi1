import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

import { aggregateBomItems } from '@/lib/data-fetchers'
import {
  safeParseBomItems,
  safeParseEstimate,
  safeParseSuppliers,
  bomEntrySchema,
  estimateTotalsSchema,
  supplierEntrySchema,
} from '@/lib/schemas/cross-step.schema'
import type {
  BomEntry,
  BomEntryWithSource,
  EstimateTotals,
  SupplierEntry,
  WbsRow,
} from '@/lib/types'

// ── Realistic mock data factories ───────────────────────────

function makeBomEntry(overrides: Partial<BomEntry> = {}): BomEntry {
  return {
    name: 'Thep tam Q345B',
    code: 'VT-001',
    spec: '10mm x 2400 x 6000',
    quantity: '150',
    unit: 'kg',
    ...overrides,
  }
}

function makeEstimateTotals(overrides: Partial<EstimateTotals> = {}): EstimateTotals {
  return {
    totalMaterial: '250000000',
    totalLabor: '80000000',
    totalService: '15000000',
    totalOverhead: '5000000',
    totalEstimate: '350000000',
    estimateFileName: 'DT02_DuAn_XYZ.xlsx',
    ...overrides,
  }
}

function makeSupplierEntry(overrides: Partial<SupplierEntry> = {}): SupplierEntry {
  return {
    name: 'Cong ty TNHH ABC',
    quotes: [
      { material: 'Thep tam Q345B', price: '18500' },
      { material: 'Son epoxy', price: '125000' },
    ],
    ...overrides,
  }
}

function makeWbsRow(overrides: Partial<WbsRow> = {}): WbsRow {
  return {
    stt: '1',
    hangMuc: 'Column C1',
    dvt: 'ton',
    khoiLuong: '12.5',
    phamVi: 'Zone A',
    batDau: '2026-04-10',
    ketThuc: '2026-05-15',
    trangThai: 'Chua bat dau',
    cutting: '5',
    welding: '3',
    ...overrides,
  }
}

function makeStepResult(resultData: Record<string, unknown> | null, status = 'DONE') {
  return { resultData, status }
}

// ════════════════════════════════════════════════════════════════
// BOM Flow: P2.1/P2.2/P2.3 → aggregateBomItems → P3.2 consumer
// ════════════════════════════════════════════════════════════════

describe('BOM cross-step flow', () => {
  it('P2.1 BOM output passes through aggregateBomItems to P3.2 consumer shape', async () => {
    const p21Bom = [
      makeBomEntry({ name: 'Thep tam', code: 'VT-001', quantity: '100' }),
      makeBomEntry({ name: 'Thep hinh', code: 'VT-002', quantity: '50' }),
    ]
    const p22Bom = [
      makeBomEntry({ name: 'Son epoxy', code: 'VT-010', quantity: '20' }),
    ]
    const p23Bom = [
      makeBomEntry({ name: 'Bu long M16', code: 'VT-020', quantity: '200' }),
    ]

    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P2.1') return makeStepResult({ bomItems: p21Bom }) as never
      if (where.stepCode === 'P2.2') return makeStepResult({ bomItems: p22Bom }) as never
      if (where.stepCode === 'P2.3') return makeStepResult({ bomItems: p23Bom }) as never
      return null as never
    })

    const items = await aggregateBomItems('proj-001', 'short')

    // P3.2 consumer expects BomEntryWithSource[] — verify shape
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item).toHaveProperty('name')
      expect(item).toHaveProperty('code')
      expect(item).toHaveProperty('spec')
      expect(item).toHaveProperty('quantity')
      expect(item).toHaveProperty('unit')
      expect(item).toHaveProperty('source')
      expect(['P2.1', 'P2.2', 'P2.3']).toContain(item.source)
    }
  })

  it('BOM item with empty name is filtered by aggregateBomItems (regression)', async () => {
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P2.1') {
        return makeStepResult({
          bomItems: [
            makeBomEntry({ name: 'Valid' }),
            makeBomEntry({ name: '' }),       // Should be filtered
            makeBomEntry({ name: '  \t ' }),  // Whitespace-only, should be filtered
          ],
        }) as never
      }
      return makeStepResult({ bomItems: [] }) as never
    })

    const items = await aggregateBomItems('proj-001')

    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Valid')
  })

  it('BOM item with missing code (P4.4 regression) is still valid via BomEntry type', () => {
    // P4.4 historically produced BOM items without code field.
    // The Zod schema defaults code to '' when missing.
    const itemWithoutCode = { name: 'Some material', spec: '10mm', quantity: '5', unit: 'kg' }
    const parsed = bomEntrySchema.safeParse(itemWithoutCode)

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.code).toBe('') // default from schema
    }
  })
})

// ════════════════════════════════════════════════════════════════
// Estimate Flow: P1.2 output → EstimateTotals interface
// ════════════════════════════════════════════════════════════════

describe('Estimate cross-step flow', () => {
  it('P1.2 estimate output satisfies EstimateTotals interface', () => {
    const estimateOutput = makeEstimateTotals()
    const parsed = estimateTotalsSchema.safeParse(estimateOutput)

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.totalMaterial).toBe('250000000')
      expect(parsed.data.totalEstimate).toBe('350000000')
      expect(parsed.data.estimateFileName).toBe('DT02_DuAn_XYZ.xlsx')
    }
  })

  it('Estimate with string totalEstimate is accepted (regression)', () => {
    const estimate = makeEstimateTotals({ totalEstimate: '999999' })
    const parsed = safeParseEstimate(estimate)

    expect(parsed).not.toBeNull()
    expect(parsed!.totalEstimate).toBe('999999')
  })

  it('Estimate with number totalEstimate is also accepted (regression)', () => {
    const estimate = makeEstimateTotals({ totalEstimate: 999999 })
    const parsed = safeParseEstimate(estimate)

    expect(parsed).not.toBeNull()
    expect(parsed!.totalEstimate).toBe(999999)
  })

  it('Estimate with optional fields omitted is still valid', () => {
    const minimal: Record<string, unknown> = {
      totalMaterial: '100',
      totalLabor: '200',
      totalEstimate: '300',
      // totalService, totalOverhead, estimateFileName, dt02Detail all omitted
    }
    const parsed = safeParseEstimate(minimal)

    expect(parsed).not.toBeNull()
    expect(parsed!.totalService).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// Supplier Flow: P3.5 output → SupplierEntry[] shape
// ════════════════════════════════════════════════════════════════

describe('Supplier cross-step flow', () => {
  it('P3.5 supplier output satisfies SupplierEntry[] shape', () => {
    const suppliers = [
      makeSupplierEntry({ name: 'Supplier A' }),
      makeSupplierEntry({ name: 'Supplier B', quotes: [{ material: 'Bu long', price: '5000' }] }),
    ]
    const parsed = safeParseSuppliers(suppliers)

    expect(parsed).not.toBeNull()
    expect(parsed).toHaveLength(2)
    expect(parsed![0].name).toBe('Supplier A')
    expect(parsed![1].quotes).toHaveLength(1)
  })

  it('Supplier entry with empty quotes array is valid', () => {
    const suppliers = [makeSupplierEntry({ quotes: [] })]
    const parsed = safeParseSuppliers(suppliers)

    expect(parsed).not.toBeNull()
    expect(parsed![0].quotes).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════
// WBS Flow: P1.2A output → WbsRow[] JSON string
// ════════════════════════════════════════════════════════════════

describe('WBS cross-step flow', () => {
  it('P1.2A wbsItems output is a valid JSON string of WbsRow[]', () => {
    const rows: WbsRow[] = [
      makeWbsRow({ stt: '1', hangMuc: 'Column C1' }),
      makeWbsRow({ stt: '2', hangMuc: 'Beam B1', khoiLuong: '8.3' }),
    ]
    const jsonStr = JSON.stringify(rows)

    // Simulate what P1.3 / P3.1 receives as previousStepData.plan.wbsItems
    const parsed = JSON.parse(jsonStr) as WbsRow[]

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].hangMuc).toBe('Column C1')
    expect(parsed[1].khoiLuong).toBe('8.3')
  })

  it('WbsRow supports dynamic columns (not just base + stage keys)', () => {
    const row: WbsRow = makeWbsRow({
      customColumn: 'extra data',
      anotherCustom: '42',
    })

    // WbsRow is Record<string, string> — any key is valid
    expect(row.customColumn).toBe('extra data')
    expect(row.anotherCustom).toBe('42')
    expect(row.hangMuc).toBe('Column C1')
  })
})

// ════════════════════════════════════════════════════════════════
// Zod Schema Validation — valid and malformed data
// ════════════════════════════════════════════════════════════════

describe('Zod schema validation', () => {
  describe('safeParseBomItems', () => {
    it('valid BOM items array passes validation', () => {
      const items = [makeBomEntry(), makeBomEntry({ name: 'Son' })]
      const result = safeParseBomItems(items)

      expect(result).not.toBeNull()
      expect(result).toHaveLength(2)
    })

    it('accepts JSON string of BOM items', () => {
      const items = [makeBomEntry()]
      const result = safeParseBomItems(JSON.stringify(items))

      expect(result).not.toBeNull()
      expect(result).toHaveLength(1)
    })

    it('returns null for malformed data (missing required fields)', () => {
      const malformed = [{ name: 'Only name' }] // missing quantity, unit
      const result = safeParseBomItems(malformed)

      expect(result).toBeNull()
    })

    it('returns null for non-array input', () => {
      const result = safeParseBomItems({ name: 'not an array' })

      expect(result).toBeNull()
    })

    it('returns null for invalid JSON string', () => {
      const result = safeParseBomItems('not valid json {{{')

      expect(result).toBeNull()
    })
  })

  describe('safeParseEstimate', () => {
    it('valid estimate object passes validation', () => {
      const est = makeEstimateTotals()
      const result = safeParseEstimate(est)

      expect(result).not.toBeNull()
      expect(result!.totalEstimate).toBe('350000000')
    })

    it('accepts JSON string of estimate', () => {
      const est = makeEstimateTotals()
      const result = safeParseEstimate(JSON.stringify(est))

      expect(result).not.toBeNull()
    })

    it('returns null for malformed data (missing totalEstimate)', () => {
      const malformed = { totalMaterial: '100', totalLabor: '200' }
      const result = safeParseEstimate(malformed)

      expect(result).toBeNull()
    })

    it('returns null for null input', () => {
      const result = safeParseEstimate(null)

      expect(result).toBeNull()
    })
  })

  describe('safeParseSuppliers', () => {
    it('valid supplier array passes validation', () => {
      const suppliers = [makeSupplierEntry()]
      const result = safeParseSuppliers(suppliers)

      expect(result).not.toBeNull()
      expect(result).toHaveLength(1)
    })

    it('returns null for supplier with missing quotes field', () => {
      const malformed = [{ name: 'No quotes' }]
      const result = safeParseSuppliers(malformed)

      expect(result).toBeNull()
    })

    it('returns null for undefined input', () => {
      const result = safeParseSuppliers(undefined)

      expect(result).toBeNull()
    })
  })
})
