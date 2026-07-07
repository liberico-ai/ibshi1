import { describe, it, expect } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

import { aggregateBomItems } from '@/lib/data-fetchers'
import {
  safeParseBomItems,
  safeParseEstimate,
  safeParseSuppliers,
  bomEntrySchema,
  estimateTotalsSchema,
} from '@/lib/schemas/cross-step.schema'
import type {
  BomEntry,
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

    prismaMock.task.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { taskType: string } }
      if (where.taskType === 'P2.1') return makeStepResult({ bomItems: p21Bom }) as never
      if (where.taskType === 'P2.2') return makeStepResult({ bomItems: p22Bom }) as never
      if (where.taskType === 'P2.3') return makeStepResult({ bomItems: p23Bom }) as never
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
    prismaMock.task.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { taskType: string } }
      if (where.taskType === 'P2.1') {
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

// ════════════════════════════════════════════════════════════════
// Quote Groups: P3.5/P3.6 JSON ↔ table sync (dual-write parity)
// ════════════════════════════════════════════════════════════════

function makeQuoteGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'GROUP_1719000000001',
    name: 'Nhóm thép tấm',
    status: 'PENDING',
    totalValue: 185000000,
    items: [
      {
        name: 'Thép tấm Q345B',
        code: 'VT-001',
        spec: '10mm x 2400 x 6000',
        unit: 'kg',
        source: 'P2.1',
        quantity: '150',
        requestedQty: 150,
        inStock: 30,
        shortfall: 120,
        specMatch: true,
        matchedMaterial: { code: 'VT-001', name: 'Thép tấm Q345B', spec: '10mm' },
        selectedQuoteIndex: 1,
        quotes: [
          { ncc: 'NCC Alpha', price: 18000 },
          { ncc: 'NCC Beta', price: 17500 },
          { ncc: 'NCC Gamma', price: 19000 },
        ],
      },
    ],
    ...overrides,
  }
}

describe('Quote group sync (dual-write)', () => {
  it('syncQuoteGroups calls upsert for each group with correct groupKey', async () => {
    const { syncQuoteGroups } = await import('@/lib/quote-sync')

    const groups = [
      makeQuoteGroup({ id: 'G1', name: 'Nhóm 1' }),
      makeQuoteGroup({ id: 'G2', name: 'Nhóm 2', status: 'APPROVED' }),
    ]

    // Mock upsert to return a group with id
    prismaMock.quoteGroup.upsert.mockResolvedValue({ id: 'qg-mock-1' } as any)
    prismaMock.quoteGroupItem.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.quoteGroupItem.create.mockResolvedValue({ id: 'qi-mock-1' } as any)
    prismaMock.supplierQuoteLine.createMany.mockResolvedValue({ count: 3 })

    await syncQuoteGroups('task-1', 'proj-1', groups)

    expect(prismaMock.quoteGroup.upsert).toHaveBeenCalledTimes(2)

    // First call: group G1
    const call1 = prismaMock.quoteGroup.upsert.mock.calls[0][0]
    expect(call1.where.taskId_groupKey).toEqual({ taskId: 'task-1', groupKey: 'G1' })
    expect(call1.create.name).toBe('Nhóm 1')
    expect(call1.create.status).toBe('PENDING')

    // Second call: group G2
    const call2 = prismaMock.quoteGroup.upsert.mock.calls[1][0]
    expect(call2.where.taskId_groupKey).toEqual({ taskId: 'task-1', groupKey: 'G2' })
    expect(call2.create.status).toBe('APPROVED')
  })

  it('syncQuoteGroups creates items + quote lines for each group', async () => {
    const { syncQuoteGroups } = await import('@/lib/quote-sync')

    const group = makeQuoteGroup()

    prismaMock.quoteGroup.upsert.mockResolvedValue({ id: 'qg-1' } as any)
    prismaMock.quoteGroupItem.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.quoteGroupItem.create.mockResolvedValue({ id: 'qi-1' } as any)
    prismaMock.supplierQuoteLine.createMany.mockResolvedValue({ count: 3 })

    await syncQuoteGroups('task-1', 'proj-1', [group])

    // 1 item created
    expect(prismaMock.quoteGroupItem.create).toHaveBeenCalledTimes(1)
    const itemData = prismaMock.quoteGroupItem.create.mock.calls[0][0].data
    expect(itemData.name).toBe('Thép tấm Q345B')
    expect(itemData.shortfall).toBe(120)
    expect(itemData.selectedQuoteIndex).toBe(1)

    // 3 quote lines created via createMany
    expect(prismaMock.supplierQuoteLine.createMany).toHaveBeenCalledTimes(1)
    const linesData = prismaMock.supplierQuoteLine.createMany.mock.calls[0]?.[0]?.data as any[]
    expect(linesData).toHaveLength(3)
    expect(linesData[0].supplierName).toBe('NCC Alpha')
    expect(linesData[1].unitPrice).toBe(17500)
    expect(linesData[2].lineIndex).toBe(2)
  })

  it('syncQuoteGroups handles group with no items gracefully', async () => {
    const { syncQuoteGroups } = await import('@/lib/quote-sync')

    const emptyGroup = makeQuoteGroup({ items: [] })

    prismaMock.quoteGroup.upsert.mockResolvedValue({ id: 'qg-empty' } as any)
    prismaMock.quoteGroupItem.deleteMany.mockResolvedValue({ count: 0 })

    await syncQuoteGroups('task-1', null, [emptyGroup])

    expect(prismaMock.quoteGroup.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.quoteGroupItem.create).not.toHaveBeenCalled()
    expect(prismaMock.supplierQuoteLine.createMany).not.toHaveBeenCalled()
  })

  it('readApprovedGroups maps table data to tracking list shape', async () => {
    const { readApprovedGroups } = await import('@/lib/quote-sync')

    prismaMock.quoteGroup.findMany.mockResolvedValue([
      {
        id: 'qg-1',
        taskId: 'task-1',
        projectId: 'proj-1',
        groupKey: 'GROUP_123',
        name: 'Nhóm thép',
        status: 'APPROVED',
        totalValue: 185000000 as any,
        prCode: 'PR-100-01',
        paymentStatus: 'PENDING',
        deliveryDate: new Date('2026-08-01'),
        paymentDate: null,
        assignedSupplier: 'NCC Beta',
        rejectedReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        task: { id: 'task-1' },
        project: { id: 'proj-1', projectName: 'Dự án ABC', projectCode: '26-ABC-001' },
        items: [
          {
            id: 'qi-1',
            quoteGroupId: 'qg-1',
            name: 'Thép tấm',
            code: 'VT-001',
            spec: '10mm',
            unit: 'kg',
            source: 'P2.1',
            quantity: '150',
            requestedQty: 150 as any,
            inStock: 30 as any,
            shortfall: 120 as any,
            specMatch: true,
            matchedMaterialJson: { code: 'VT-001' },
            selectedQuoteIndex: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            quoteLines: [
              { id: 'ql-1', itemId: 'qi-1', lineIndex: 0, supplierName: 'NCC Alpha', unitPrice: 18000 as any, createdAt: new Date() },
              { id: 'ql-2', itemId: 'qi-1', lineIndex: 1, supplierName: 'NCC Beta', unitPrice: 17500 as any, createdAt: new Date() },
              { id: 'ql-3', itemId: 'qi-1', lineIndex: 2, supplierName: 'NCC Gamma', unitPrice: 19000 as any, createdAt: new Date() },
            ],
          },
        ],
      },
    ] as any)

    const result = await readApprovedGroups()

    expect(result).toHaveLength(1)
    const g = result[0]
    expect(g.groupId).toBe('GROUP_123')
    expect(g.groupName).toBe('Nhóm thép')
    expect(g.supplier).toBe('NCC Beta')
    expect(g.prCode).toBe('PR-100-01')
    expect(g.totalValue).toBe(185000000)
    expect(g.items).toHaveLength(1)
    expect(g.items[0].quotes).toHaveLength(3)
    expect(g.items[0].quotes[1].ncc).toBe('NCC Beta')
    expect(g.items[0].quotes[1].price).toBe(17500)
    expect(g.paymentStatus).toBe('PENDING')
    expect(g.deliveryDate).toContain('2026-08-01')
  })

  it('USE_QUOTE_TABLES defaults to false (flag OFF)', async () => {
    const { USE_QUOTE_TABLES } = await import('@/lib/quote-sync')
    expect(USE_QUOTE_TABLES).toBe(false)
  })
})
