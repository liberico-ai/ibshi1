import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

import { diffBomVersions, computeImpact, computeNormLines } from '@/lib/bom-diff-engine'
import type { BomLineSnapshot, BomCategory } from '@/lib/bom-diff-engine'

// ── Mock data factories ──

function makeBomDbItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    bomVersionId: 'v1',
    materialId: 'mat-1',
    material: { materialCode: 'VT-001', name: 'Thép tấm Q345B' },
    category: 'MAIN' as const,
    pieceMark: 'C1',
    profile: 'H200x200',
    grade: 'Q345B',
    quantity: 100,
    unit: 'kg',
    sortOrder: 1,
    ...overrides,
  }
}

function makeMainLine(overrides: Partial<BomLineSnapshot> = {}): BomLineSnapshot {
  return {
    id: 'line-1',
    bomVersionId: 'v1',
    materialId: 'mat-1',
    materialCode: 'VT-001',
    materialName: 'Thép tấm Q345B',
    category: 'MAIN',
    pieceMark: 'C1',
    profile: 'H200x200',
    grade: 'Q345B',
    quantity: 100,
    unit: 'kg',
    ...overrides,
  }
}

// ════════════════════════════════════════════════════════════════
// diffBomVersions
// ════════════════════════════════════════════════════════════════

describe('diffBomVersions', () => {
  it('identical versions → empty diff', async () => {
    const item = makeBomDbItem({ bomVersionId: 'v1' })
    const itemClone = { ...item, id: 'item-1b', bomVersionId: 'v2' }

    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([item] as never)   // old version
      .mockResolvedValueOnce([itemClone] as never) // new version

    const result = await diffBomVersions('v1', 'v2')

    expect(result.lines).toHaveLength(0)
    expect(result.summary.added).toBe(0)
    expect(result.summary.removed).toBe(0)
    expect(result.summary.qtyChanged).toBe(0)
    expect(result.summary.specChanged).toBe(0)
    expect(result.summary.totalDeltaQty).toBe(0)
  })

  it('added items → action=ADDED with positive qtyDelta', async () => {
    const newItem1 = makeBomDbItem({ id: 'new-1', bomVersionId: 'v2', materialId: 'mat-1', pieceMark: 'C1', quantity: 50 })
    const newItem2 = makeBomDbItem({ id: 'new-2', bomVersionId: 'v2', materialId: 'mat-2', pieceMark: 'C2', quantity: 30, material: { materialCode: 'VT-002', name: 'Thép hình' } })

    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([] as never)                    // old: empty
      .mockResolvedValueOnce([newItem1, newItem2] as never)  // new: 2 items

    const result = await diffBomVersions('v1', 'v2')

    expect(result.lines).toHaveLength(2)
    expect(result.lines.every(l => l.action === 'ADDED')).toBe(true)
    expect(result.lines[0].qtyDelta).toBe(50)
    expect(result.lines[0].qtyOld).toBe(0)
    expect(result.lines[0].qtyNew).toBe(50)
    expect(result.lines[1].qtyDelta).toBe(30)
    expect(result.summary.added).toBe(2)
    expect(result.summary.totalDeltaQty).toBe(80)
  })

  it('removed items → action=REMOVED with negative qtyDelta', async () => {
    const oldItem = makeBomDbItem({ id: 'old-1', bomVersionId: 'v1', quantity: 75 })

    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldItem] as never) // old: 1 item
      .mockResolvedValueOnce([] as never)        // new: empty

    const result = await diffBomVersions('v1', 'v2')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].action).toBe('REMOVED')
    expect(result.lines[0].qtyDelta).toBe(-75)
    expect(result.lines[0].qtyOld).toBe(75)
    expect(result.lines[0].qtyNew).toBe(0)
    expect(result.summary.removed).toBe(1)
    expect(result.summary.totalDeltaQty).toBe(-75)
  })

  it('quantity changed → action=QTY_CHANGED', async () => {
    const oldItem = makeBomDbItem({ id: 'old-1', bomVersionId: 'v1', quantity: 100 })
    const newItem = makeBomDbItem({ id: 'new-1', bomVersionId: 'v2', quantity: 150 })

    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldItem] as never)
      .mockResolvedValueOnce([newItem] as never)

    const result = await diffBomVersions('v1', 'v2')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].action).toBe('QTY_CHANGED')
    expect(result.lines[0].qtyOld).toBe(100)
    expect(result.lines[0].qtyNew).toBe(150)
    expect(result.lines[0].qtyDelta).toBe(50)
    expect(result.summary.qtyChanged).toBe(1)
  })

  it('spec changed (profile/grade) → action=SPEC_CHANGED', async () => {
    const oldItem = makeBomDbItem({ id: 'old-1', bomVersionId: 'v1', profile: 'H200x200', grade: 'Q345B' })
    const newItem = makeBomDbItem({ id: 'new-1', bomVersionId: 'v2', profile: 'H300x300', grade: 'Q235B' })

    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldItem] as never)
      .mockResolvedValueOnce([newItem] as never)

    const result = await diffBomVersions('v1', 'v2')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].action).toBe('SPEC_CHANGED')
    expect(result.summary.specChanged).toBe(1)
  })

  it('mixed categories → summary.byCategory correctly tallied', async () => {
    const oldMain = makeBomDbItem({ id: 'o1', bomVersionId: 'v1', category: 'MAIN', pieceMark: 'C1', quantity: 100 })
    const oldWeld = makeBomDbItem({ id: 'o2', bomVersionId: 'v1', category: 'WELD', pieceMark: 'W1', materialId: 'mat-w', material: { materialCode: 'WE-001', name: 'Que hàn' }, quantity: 20 })

    const newMain = makeBomDbItem({ id: 'n1', bomVersionId: 'v2', category: 'MAIN', pieceMark: 'C1', quantity: 120 }) // qty changed
    const newAux = makeBomDbItem({ id: 'n3', bomVersionId: 'v2', category: 'AUX', pieceMark: 'A1', materialId: 'mat-a', material: { materialCode: 'AUX-001', name: 'Bu-lông' }, quantity: 50 }) // added

    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldMain, oldWeld] as never)
      .mockResolvedValueOnce([newMain, newAux] as never)

    const result = await diffBomVersions('v1', 'v2')

    expect(result.lines).toHaveLength(3) // QTY_CHANGED main + REMOVED weld + ADDED aux
    expect(result.summary.byCategory.MAIN.qtyChanged).toBe(1)
    expect(result.summary.byCategory.MAIN.deltaQty).toBe(20) // 120-100
    expect(result.summary.byCategory.WELD.removed).toBe(1)
    expect(result.summary.byCategory.WELD.deltaQty).toBe(-20)
    expect(result.summary.byCategory.AUX.added).toBe(1)
    expect(result.summary.byCategory.AUX.deltaQty).toBe(50)
  })

  it('summary totals are correct for mixed changes', async () => {
    // 1 added, 1 removed, 1 qty changed, 1 spec changed
    const oldItems = [
      makeBomDbItem({ id: 'o1', bomVersionId: 'v1', pieceMark: 'C1', materialId: 'mat-1', quantity: 100, material: { materialCode: 'VT-001', name: 'A' } }),
      makeBomDbItem({ id: 'o2', bomVersionId: 'v1', pieceMark: 'C2', materialId: 'mat-2', quantity: 50, material: { materialCode: 'VT-002', name: 'B' } }),
      makeBomDbItem({ id: 'o3', bomVersionId: 'v1', pieceMark: 'C3', materialId: 'mat-3', quantity: 30, material: { materialCode: 'VT-003', name: 'C' } }),
    ]
    const newItems = [
      // C1 qty changed 100→120
      makeBomDbItem({ id: 'n1', bomVersionId: 'v2', pieceMark: 'C1', materialId: 'mat-1', quantity: 120, material: { materialCode: 'VT-001', name: 'A' } }),
      // C2 removed (not present)
      // C3 spec changed
      makeBomDbItem({ id: 'n3', bomVersionId: 'v2', pieceMark: 'C3', materialId: 'mat-3', quantity: 30, profile: 'H400x400', grade: 'Q460', material: { materialCode: 'VT-003', name: 'C' } }),
      // C4 added
      makeBomDbItem({ id: 'n4', bomVersionId: 'v2', pieceMark: 'C4', materialId: 'mat-4', quantity: 60, material: { materialCode: 'VT-004', name: 'D' } }),
    ]

    prismaMock.bomItem.findMany
      .mockResolvedValueOnce(oldItems as never)
      .mockResolvedValueOnce(newItems as never)

    const result = await diffBomVersions('v1', 'v2')

    expect(result.summary.added).toBe(1)
    expect(result.summary.removed).toBe(1)
    expect(result.summary.qtyChanged).toBe(1)
    expect(result.summary.specChanged).toBe(1)
    // totalDeltaQty = +20 (qty) + 0 (spec, same qty) + -50 (removed) + 60 (added) = 30
    expect(result.summary.totalDeltaQty).toBe(30)
  })
})

// ════════════════════════════════════════════════════════════════
// computeImpact
// ════════════════════════════════════════════════════════════════

describe('computeImpact', () => {
  const versionPayload = {
    id: 'v-draft',
    bomId: 'bom-1',
    bom: { projectId: 'proj-1', id: 'bom-1' },
  }

  function mockProcurement(opts: { prQty?: number; poQty?: number; stockQty?: number } = {}) {
    prismaMock.purchaseRequestItem.findMany.mockResolvedValue(
      opts.prQty ? [{ quantity: opts.prQty }] as never : [] as never
    )
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue(
      opts.poQty ? [{ quantity: opts.poQty }] as never : [] as never
    )
    prismaMock.material.findUnique.mockResolvedValue(
      { currentStock: opts.stockQty ?? 0 } as never
    )
  }

  it('ADDED line with no stock → suggests ADD_PR', async () => {
    prismaMock.bomVersion.findUniqueOrThrow.mockResolvedValue(versionPayload as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'v-active' } as never)

    // diff: 1 added item
    const newItem = makeBomDbItem({ id: 'n1', bomVersionId: 'v-draft', quantity: 50 })
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([] as never)       // active version lines (empty)
      .mockResolvedValueOnce([newItem] as never) // draft version lines

    mockProcurement({ prQty: 0, poQty: 0, stockQty: 0 })

    const result = await computeImpact('v-draft')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].suggestedActionCode).toBe('ADD_PR')
    expect(result.summary.needPurchase).toBe(1)
  })

  it('ADDED line with enough stock → suggests USE_STOCK', async () => {
    prismaMock.bomVersion.findUniqueOrThrow.mockResolvedValue(versionPayload as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'v-active' } as never)

    const newItem = makeBomDbItem({ id: 'n1', bomVersionId: 'v-draft', quantity: 30 })
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([newItem] as never)

    mockProcurement({ stockQty: 50 }) // stock >= qtyDelta (30)

    const result = await computeImpact('v-draft')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].suggestedActionCode).toBe('USE_STOCK')
    expect(result.summary.canUseStock).toBe(1)
  })

  it('REMOVED line in PR → suggests CANCEL_PR', async () => {
    prismaMock.bomVersion.findUniqueOrThrow.mockResolvedValue(versionPayload as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'v-active' } as never)

    const oldItem = makeBomDbItem({ id: 'o1', bomVersionId: 'v-active', quantity: 40 })
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldItem] as never) // active version
      .mockResolvedValueOnce([] as never)        // draft version (removed)

    mockProcurement({ prQty: 40 })

    const result = await computeImpact('v-draft')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].suggestedActionCode).toBe('CANCEL_PR')
  })

  it('REMOVED line in PO → suggests ALERT_PO', async () => {
    prismaMock.bomVersion.findUniqueOrThrow.mockResolvedValue(versionPayload as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'v-active' } as never)

    const oldItem = makeBomDbItem({ id: 'o1', bomVersionId: 'v-active', quantity: 60 })
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldItem] as never)
      .mockResolvedValueOnce([] as never)

    mockProcurement({ poQty: 60 })

    const result = await computeImpact('v-draft')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].suggestedActionCode).toBe('ALERT_PO')
    expect(result.summary.needPOAlert).toBe(1)
  })

  it('REMOVED line in stock → suggests RETURN_STOCK', async () => {
    prismaMock.bomVersion.findUniqueOrThrow.mockResolvedValue(versionPayload as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'v-active' } as never)

    const oldItem = makeBomDbItem({ id: 'o1', bomVersionId: 'v-active', quantity: 25 })
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldItem] as never)
      .mockResolvedValueOnce([] as never)

    // poQty > 0 && stockQty > 0 → status = IN_STOCK
    mockProcurement({ poQty: 25, stockQty: 25 })

    const result = await computeImpact('v-draft')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].suggestedActionCode).toBe('RETURN_STOCK')
  })

  it('SPEC_CHANGED line in stock → suggests NCR', async () => {
    prismaMock.bomVersion.findUniqueOrThrow.mockResolvedValue(versionPayload as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'v-active' } as never)

    const oldItem = makeBomDbItem({ id: 'o1', bomVersionId: 'v-active', profile: 'H200x200', grade: 'Q345B', quantity: 80 })
    const newItem = makeBomDbItem({ id: 'n1', bomVersionId: 'v-draft', profile: 'H300x300', grade: 'Q235B', quantity: 80 })
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([oldItem] as never)
      .mockResolvedValueOnce([newItem] as never)

    mockProcurement({ poQty: 80, stockQty: 80 }) // IN_STOCK

    const result = await computeImpact('v-draft')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].suggestedActionCode).toBe('NCR')
    expect(result.summary.needNCR).toBe(1)
  })

  it('no active version → returns empty impact', async () => {
    prismaMock.bomVersion.findUniqueOrThrow.mockResolvedValue(versionPayload as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue(null as never) // no active version

    const result = await computeImpact('v-draft')

    expect(result.lines).toHaveLength(0)
    expect(result.summary.totalChanges).toBe(0)
    expect(result.summary.needPurchase).toBe(0)
    expect(result.summary.canUseStock).toBe(0)
    expect(result.summary.needPOAlert).toBe(0)
    expect(result.summary.needNCR).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// computeNormLines
// ════════════════════════════════════════════════════════════════

describe('computeNormLines', () => {
  it('no norms → empty array', async () => {
    prismaMock.norm.findMany.mockResolvedValue([] as never)

    const mainLines = [makeMainLine({ quantity: 500 })]
    const result = await computeNormLines(mainLines, 'proj-1')

    expect(result).toEqual([])
  })

  it('welding norm (kg/kg) → calculates from total main weight', async () => {
    prismaMock.norm.findMany.mockResolvedValue([
      {
        id: 'norm-1',
        projectId: null,
        category: 'WELD',
        code: 'WE-E7018',
        name: 'Que hàn E7018',
        unit: 'kg',
        rate: 0.03, // 0.03 kg weld rod per kg steel
        basisUnit: 'kg',
        materialId: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never)

    const mainLines = [
      makeMainLine({ quantity: 1000 }),
      makeMainLine({ id: 'line-2', pieceMark: 'C2', quantity: 500 }),
    ]

    const result = await computeNormLines(mainLines, 'proj-1')

    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('WELD')
    expect(result[0].normCode).toBe('WE-E7018')
    expect(result[0].basisValue).toBe(1500) // total main weight
    expect(result[0].quantity).toBe(45) // 1500 * 0.03
    expect(result[0].unit).toBe('kg')
  })

  it('paint norm (L/m²) → calculates from estimated surface area', async () => {
    prismaMock.norm.findMany.mockResolvedValue([
      {
        id: 'norm-2',
        projectId: 'proj-1',
        category: 'PAINT',
        code: 'PAINT-EP01',
        name: 'Sơn epoxy',
        unit: 'L',
        rate: 0.2, // 0.2 L per m²
        basisUnit: 'm²',
        materialId: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never)

    const mainLines = [makeMainLine({ quantity: 2000 })] // 2000 kg steel

    const result = await computeNormLines(mainLines, 'proj-1')

    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('PAINT')
    // basisValue = 2000 * 0.15 = 300 m²
    expect(result[0].basisValue).toBe(300)
    // quantity = 300 * 0.2 = 60 L
    expect(result[0].quantity).toBe(60)
    expect(result[0].unit).toBe('L')
  })
})
