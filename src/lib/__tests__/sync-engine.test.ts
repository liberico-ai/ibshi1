/**
 * Unit tests for src/lib/sync-engine.ts
 *
 * All Prisma calls are mocked via the __mocks__/db.ts auto-mock pattern.
 */

import { vi } from 'vitest'

// ── Mock Prisma ──
import { prismaMock } from '@/lib/__mocks__/db'
import {
  logChangeEvent,
  syncBOMtoBudget,
  syncPOtoBudget,
  recalcBudgetActual,
  recalcPOTotal,
  runReverseHooks,
} from '@/lib/sync-engine'

// ── Helpers ──

const PROJECT_ID = 'proj-1'
const USER = 'user-1'

// ── logChangeEvent ──

describe('logChangeEvent', () => {
  it('creates a ChangeEvent with all provided fields', async () => {
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await logChangeEvent({
      projectId: PROJECT_ID,
      sourceStep: 'P2.2',
      sourceModel: 'BillOfMaterial',
      sourceId: 'bom-1',
      eventType: 'SYNC',
      targetModel: 'Budget',
      targetId: 'budget-1',
      dataBefore: { planned: 0 },
      dataAfter: { planned: 1000 },
      reason: 'test reason',
      triggeredBy: USER,
    })

    expect(prismaMock.changeEvent.create).toHaveBeenCalledOnce()
    const call = prismaMock.changeEvent.create.mock.calls[0][0]
    expect(call.data).toMatchObject({
      projectId: PROJECT_ID,
      sourceStep: 'P2.2',
      sourceModel: 'BillOfMaterial',
      sourceId: 'bom-1',
      eventType: 'SYNC',
      targetModel: 'Budget',
      targetId: 'budget-1',
      triggeredBy: USER,
      reason: 'test reason',
    })
  })

  it('omits dataBefore/dataAfter when not provided', async () => {
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await logChangeEvent({
      projectId: PROJECT_ID,
      sourceStep: 'P2.2',
      sourceModel: 'BillOfMaterial',
      sourceId: 'bom-1',
      eventType: 'SYNC',
      targetModel: 'Budget',
      targetId: 'budget-1',
      triggeredBy: USER,
    })

    const call = prismaMock.changeEvent.create.mock.calls[0][0]
    expect(call.data.dataBefore).toBeUndefined()
    expect(call.data.dataAfter).toBeUndefined()
  })
})

// ── syncBOMtoBudget ──

describe('syncBOMtoBudget', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
  })

  it('calculates totalPlanned from BOM items and updates existing budget', async () => {
    const budget = { id: 'budget-1', planned: 500 }
    prismaMock.billOfMaterial.findMany.mockResolvedValue([
      {
        id: 'bom-1',
        items: [
          { quantity: 10, material: { unitPrice: 20 } },
          { quantity: 5, material: { unitPrice: 30 } },
        ],
      },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue(budget as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncBOMtoBudget(PROJECT_ID, USER)

    // 10*20 + 5*30 = 350
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { planned: 350 },
    })
  })

  it('creates a new budget when none exists', async () => {
    prismaMock.billOfMaterial.findMany.mockResolvedValue([
      {
        id: 'bom-1',
        items: [{ quantity: 2, material: { unitPrice: 100 } }],
      },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncBOMtoBudget(PROJECT_ID, USER)

    expect(prismaMock.budget.create).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID, category: 'MATERIAL', planned: 200 },
    })
    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })

  it('treats null unitPrice as zero', async () => {
    prismaMock.billOfMaterial.findMany.mockResolvedValue([
      {
        id: 'bom-1',
        items: [{ quantity: 10, material: { unitPrice: null } }],
      },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncBOMtoBudget(PROJECT_ID, USER)

    expect(prismaMock.budget.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ planned: 0 }) }),
    )
  })
})

// ── syncPOtoBudget (recompute) ──

describe('syncPOtoBudget', () => {
  it('recomputes committed from all approved POs', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { totalValue: 3000 },
      { totalValue: 2000 },
    ] as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1', committed: 999 } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { committed: 5000 },
    })
  })

  it('is idempotent — calling twice yields same committed', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { totalValue: 5000 },
    ] as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1', committed: 5000 } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)
    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    const calls = prismaMock.budget.update.mock.calls
    expect(calls.every((c: any) => c[0].data.committed === 5000)).toBe(true)
  })

  it('does nothing when no budget exists', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ totalValue: 1000 }] as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.budget.findFirst.mockResolvedValue(null)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })
})


// ── recalcPOTotal ──

describe('recalcPOTotal', () => {
  it('sums qty × unitPrice for all PO items and updates totalValue', async () => {
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { quantity: 10, unitPrice: 100 },
      { quantity: 5, unitPrice: 200 },
    ] as any)
    prismaMock.purchaseOrder.update.mockResolvedValue({} as any)

    const total = await recalcPOTotal('po-1')

    expect(total).toBe(2000) // 10*100 + 5*200
    expect(prismaMock.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { totalValue: 2000 },
    })
  })

  it('returns 0 for PO with no items', async () => {
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrder.update.mockResolvedValue({} as any)

    const total = await recalcPOTotal('po-empty')
    expect(total).toBe(0)
  })
})

// ── recalcBudgetActual ──

describe('recalcBudgetActual', () => {
  it('uses PO item price when poItemId is set', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { quantity: 10, poItemId: 'poi-1', materialId: 'mat-1' },
      { quantity: 5, poItemId: 'poi-2', materialId: 'mat-2' },
    ] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { id: 'poi-1', unitPrice: 100 },
      { id: 'poi-2', unitPrice: 200 },
    ] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1' } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    // 10*100 + 5*200 = 2000
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: 2000 },
    })
  })

  it('falls back to material.unitPrice when no poItemId', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { quantity: 8, poItemId: null, materialId: 'mat-1' },
    ] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([
      { id: 'mat-1', unitPrice: 50 },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1' } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    // 8*50 = 400
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: 400 },
    })
  })

  it('does nothing when no budget exists', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)

    await recalcBudgetActual(PROJECT_ID, USER)

    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })
})

// ── runReverseHooks dispatcher ──

describe('runReverseHooks', () => {
  beforeEach(() => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
  })

  it('recalcs budget for Phase 3-4 rejection (P4.3)', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { quantity: 10, poItemId: 'poi-1', materialId: 'mat-1' },
    ] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { id: 'poi-1', unitPrice: 100 },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1' } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await runReverseHooks(PROJECT_ID, 'P4.3', USER, 'QC reject')

    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: 1000 },
    })
  })

  it('skips recalc for Phase 1 rejection (P1.1B)', async () => {
    await runReverseHooks(PROJECT_ID, 'P1.1B', USER, 'reject reason')

    expect(prismaMock.stockMovement.findMany).not.toHaveBeenCalled()
    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })

  it('skips recalc for Phase 2 rejection (P2.5)', async () => {
    await runReverseHooks(PROJECT_ID, 'P2.5', USER, 'reject reason')

    expect(prismaMock.stockMovement.findMany).not.toHaveBeenCalled()
  })

  it('catches errors and does not throw', async () => {
    prismaMock.stockMovement.findMany.mockRejectedValue(new Error('DB down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runReverseHooks(PROJECT_ID, 'P3.6', USER, 'fail')).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })
})
