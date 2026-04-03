import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

// Must import AFTER the mock is registered (db.ts calls vi.mock)
import {
  aggregateBomItems,
  fetchEstimateData,
  fetchSupplierData,
  fetchPoData,
  fetchPlanData,
  fetchAllMaterials,
  fetchAvailableInventory,
} from '@/lib/data-fetchers'

const PROJECT_ID = 'proj-test-001'

// ── Helpers ──────────────────────────────────────────────────

/** Build a mock WorkflowTask row with resultData */
function makeStepResult(resultData: Record<string, unknown> | null, status = 'DONE') {
  return { resultData, status }
}

/** Build a realistic BOM item */
function makeBomItem(overrides: Record<string, string> = {}) {
  return {
    name: 'Thep tam',
    code: 'VT-001',
    spec: '10mm x 2400 x 6000',
    quantity: '100',
    unit: 'kg',
    ...overrides,
  }
}

// ════════════════════════════════════════════════════════════════
// aggregateBomItems
// ════════════════════════════════════════════════════════════════

describe('aggregateBomItems', () => {
  beforeEach(() => {
    // Default: use mockImplementation to differentiate by stepCode
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P2.1') {
        return makeStepResult({
          bomItems: [makeBomItem({ name: 'Thep tam', code: 'VT-001' })],
        }) as never
      }
      if (where.stepCode === 'P2.2') {
        return makeStepResult({
          bomItems: [makeBomItem({ name: 'Son epoxy', code: 'VT-010' })],
        }) as never
      }
      if (where.stepCode === 'P2.3') {
        return makeStepResult({
          bomItems: [makeBomItem({ name: 'Bu long M16', code: 'VT-020' })],
        }) as never
      }
      return null as never
    })
  })

  it('merges BOM items from all 3 steps with short source labels', async () => {
    const items = await aggregateBomItems(PROJECT_ID, 'short')

    expect(items).toHaveLength(3)
    expect(items[0].source).toBe('P2.1')
    expect(items[1].source).toBe('P2.2')
    expect(items[2].source).toBe('P2.3')
  })

  it('merges BOM items with descriptive source labels', async () => {
    const items = await aggregateBomItems(PROJECT_ID, 'descriptive')

    expect(items).toHaveLength(3)
    expect(items[0].source).toBe('P2.1 - VT chính')
    expect(items[1].source).toBe('P2.2 - Hàn & Sơn')
    expect(items[2].source).toBe('P2.3 - VT phụ')
  })

  it('defaults to short labels when no label arg provided', async () => {
    const items = await aggregateBomItems(PROJECT_ID)

    expect(items[0].source).toBe('P2.1')
  })

  it('skips step with empty bomItems array', async () => {
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P2.1') {
        return makeStepResult({ bomItems: [makeBomItem()] }) as never
      }
      if (where.stepCode === 'P2.2') {
        return makeStepResult({ bomItems: [] }) as never
      }
      if (where.stepCode === 'P2.3') {
        return makeStepResult({ bomItems: [makeBomItem({ name: 'Bu long' })] }) as never
      }
      return null as never
    })

    const items = await aggregateBomItems(PROJECT_ID)

    expect(items).toHaveLength(2)
    expect(items.map(i => i.source)).toEqual(['P2.1', 'P2.3'])
  })

  it('filters out items with empty/whitespace-only names', async () => {
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P2.1') {
        return makeStepResult({
          bomItems: [
            makeBomItem({ name: 'Valid item' }),
            makeBomItem({ name: '' }),
            makeBomItem({ name: '   ' }),
          ],
        }) as never
      }
      return makeStepResult({ bomItems: [] }) as never
    })

    const items = await aggregateBomItems(PROJECT_ID)

    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Valid item')
  })

  it('handles step with null resultData gracefully', async () => {
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P2.1') {
        return makeStepResult(null) as never // null resultData
      }
      if (where.stepCode === 'P2.2') {
        return null as never // step not found at all
      }
      if (where.stepCode === 'P2.3') {
        return makeStepResult({ bomItems: [makeBomItem({ name: 'Only item' })] }) as never
      }
      return null as never
    })

    const items = await aggregateBomItems(PROJECT_ID)

    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Only item')
    expect(items[0].source).toBe('P2.3')
  })

  it('returns empty array when no steps have BOM data', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(null as never)

    const items = await aggregateBomItems(PROJECT_ID)

    expect(items).toEqual([])
  })

  it('preserves all BomEntry fields in returned BomEntryWithSource', async () => {
    const original = makeBomItem({ name: 'Detailed', code: 'C-99', spec: '20mm', quantity: '500', unit: 'tam' })
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P2.1') {
        return makeStepResult({ bomItems: [original] }) as never
      }
      return makeStepResult({ bomItems: [] }) as never
    })

    const items = await aggregateBomItems(PROJECT_ID)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: 'Detailed',
      code: 'C-99',
      spec: '20mm',
      quantity: '500',
      unit: 'tam',
      source: 'P2.1',
    })
  })
})

// ════════════════════════════════════════════════════════════════
// fetchEstimateData
// ════════════════════════════════════════════════════════════════

describe('fetchEstimateData', () => {
  it('returns P1.2 data only when mergeP21A is not set', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(
      makeStepResult({ totalMaterial: '100000', totalEstimate: '500000' }) as never
    )

    const result = await fetchEstimateData(PROJECT_ID)

    expect(result).toEqual({ totalMaterial: '100000', totalEstimate: '500000' })
  })

  it('returns null when P1.2 not found', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(null as never)

    const result = await fetchEstimateData(PROJECT_ID)

    expect(result).toBeNull()
  })

  it('merges P1.2 + P2.1A data when mergeP21A=true', async () => {
    // fetchEstimateData with mergeP21A calls both fetchStepResult (findFirst for P1.2)
    // and a direct prisma call (findFirst for P2.1A) in parallel
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P1.2') {
        return makeStepResult({ totalMaterial: '100', totalLabor: '200', totalEstimate: '300' }) as never
      }
      if (where.stepCode === 'P2.1A') {
        // P2.1A overrides totalLabor
        return { resultData: { totalLabor: '999', dt07Items: [{ maCP: 'DT07-1' }] } } as never
      }
      return null as never
    })

    const result = await fetchEstimateData(PROJECT_ID, { mergeP21A: true })

    expect(result).toBeDefined()
    expect(result!.totalMaterial).toBe('100')
    expect(result!.totalLabor).toBe('999') // P2.1A override
    expect(result!.dt07Items).toBeDefined() // P2.1A addition
    expect(result!.totalEstimate).toBe('300')
  })

  it('returns P1.2 data when mergeP21A=true but P2.1A not found', async () => {
    prismaMock.workflowTask.findFirst.mockImplementation((args: unknown) => {
      const { where } = args as { where: { stepCode: string } }
      if (where.stepCode === 'P1.2') {
        return makeStepResult({ totalEstimate: '500' }) as never
      }
      return null as never // P2.1A not found
    })

    const result = await fetchEstimateData(PROJECT_ID, { mergeP21A: true })

    expect(result).toEqual({ totalEstimate: '500' })
  })

  it('returns empty object when mergeP21A=true but both steps have no data', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(null as never)

    const result = await fetchEstimateData(PROJECT_ID, { mergeP21A: true })

    // Original code always returned {} (never null) for merge mode — backward compat
    expect(result).toEqual({})
  })
})

// ════════════════════════════════════════════════════════════════
// fetchSupplierData
// ════════════════════════════════════════════════════════════════

describe('fetchSupplierData', () => {
  it('returns P3.5 resultData', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(
      makeStepResult({ suppliers: [{ name: 'ABC Corp', quotes: [] }] }) as never
    )

    const result = await fetchSupplierData(PROJECT_ID)

    expect(result).toEqual({ suppliers: [{ name: 'ABC Corp', quotes: [] }] })
  })

  it('returns null when P3.5 not found', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(null as never)

    const result = await fetchSupplierData(PROJECT_ID)

    expect(result).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// fetchPoData
// ════════════════════════════════════════════════════════════════

describe('fetchPoData', () => {
  it('returns P3.7 resultData', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(
      makeStepResult({ poNumber: 'PO-2026-001', totalAmount: '1000000' }) as never
    )

    const result = await fetchPoData(PROJECT_ID)

    expect(result).toEqual({ poNumber: 'PO-2026-001', totalAmount: '1000000' })
  })

  it('returns null when P3.7 not found', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(null as never)

    const result = await fetchPoData(PROJECT_ID)

    expect(result).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// fetchPlanData
// ════════════════════════════════════════════════════════════════

describe('fetchPlanData', () => {
  it('returns P1.2A resultData', async () => {
    const wbsItems = JSON.stringify([{ stt: '1', hangMuc: 'Column' }])
    prismaMock.workflowTask.findFirst.mockResolvedValue(
      makeStepResult({ wbsItems, momSections: '[]' }) as never
    )

    const result = await fetchPlanData(PROJECT_ID)

    expect(result).toEqual({ wbsItems, momSections: '[]' })
  })

  it('returns null when P1.2A not found', async () => {
    prismaMock.workflowTask.findFirst.mockResolvedValue(null as never)

    const result = await fetchPlanData(PROJECT_ID)

    expect(result).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// fetchAllMaterials
// ════════════════════════════════════════════════════════════════

describe('fetchAllMaterials', () => {
  it('returns material array with correct fields', async () => {
    const materials = [
      { materialCode: 'VT-001', name: 'Thep tam', specification: '10mm', currentStock: 500, unit: 'kg' },
      { materialCode: 'VT-002', name: 'Son', specification: null, currentStock: 0, unit: 'lit' },
    ]
    prismaMock.material.findMany.mockResolvedValue(materials as never)

    const result = await fetchAllMaterials()

    expect(result).toHaveLength(2)
    expect(result[0].materialCode).toBe('VT-001')
    expect(result[1].specification).toBeNull()
  })

  it('calls prisma.material.findMany with correct select — no where, no category', async () => {
    prismaMock.material.findMany.mockResolvedValue([] as never)

    await fetchAllMaterials()

    expect(prismaMock.material.findMany).toHaveBeenCalledWith({
      select: {
        materialCode: true,
        name: true,
        specification: true,
        currentStock: true,
        unit: true,
      },
    })
  })
})

// ════════════════════════════════════════════════════════════════
// fetchAvailableInventory
// ════════════════════════════════════════════════════════════════

describe('fetchAvailableInventory', () => {
  it('returns materials with stock > 0 including category', async () => {
    const materials = [
      { materialCode: 'VT-001', name: 'Thep tam', specification: '10mm', currentStock: 500, unit: 'kg', category: 'Thep' },
    ]
    prismaMock.material.findMany.mockResolvedValue(materials as never)

    const result = await fetchAvailableInventory()

    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('Thep')
  })

  it('calls prisma.material.findMany with where gt:0, category, orderBy, take:200', async () => {
    prismaMock.material.findMany.mockResolvedValue([] as never)

    await fetchAvailableInventory()

    expect(prismaMock.material.findMany).toHaveBeenCalledWith({
      where: { currentStock: { gt: 0 } },
      select: {
        materialCode: true,
        name: true,
        specification: true,
        currentStock: true,
        unit: true,
        category: true,
      },
      orderBy: { category: 'asc' },
      take: 200,
    })
  })
})
