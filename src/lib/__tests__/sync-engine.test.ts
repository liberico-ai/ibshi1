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
  syncGRNtoBudget,
  syncECOcascade,
  reverseStockMovement,
  reverseMaterialIssue,
  reverseDelivery,
  reverseWOstatus,
  recalcBudgetActual,
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

// ── syncPOtoBudget ──

describe('syncPOtoBudget', () => {
  it('increments budget.committed by PO totalValue', async () => {
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({
      id: 'po-1',
      totalValue: 5000,
    } as any)
    prismaMock.budget.findFirst.mockResolvedValue({
      id: 'budget-1',
      committed: 1000,
    } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { committed: { increment: 5000 } },
    })
  })

  it('returns early when PO not found', async () => {
    prismaMock.purchaseOrder.findUnique.mockResolvedValue(null)

    await syncPOtoBudget(PROJECT_ID, 'po-missing', USER)

    expect(prismaMock.budget.findFirst).not.toHaveBeenCalled()
  })

  it('returns early when PO has no totalValue', async () => {
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({
      id: 'po-1',
      totalValue: null,
    } as any)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    expect(prismaMock.budget.findFirst).not.toHaveBeenCalled()
  })
})

// ── syncGRNtoBudget ──

describe('syncGRNtoBudget', () => {
  it('increments budget.actual by GRN amount', async () => {
    prismaMock.budget.findFirst.mockResolvedValue({
      id: 'budget-1',
      actual: 200,
    } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncGRNtoBudget(PROJECT_ID, 800, USER)

    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: { increment: 800 } },
    })
  })

  it('does nothing when no budget record exists', async () => {
    prismaMock.budget.findFirst.mockResolvedValue(null)

    await syncGRNtoBudget(PROJECT_ID, 500, USER)

    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })
})

// ── syncECOcascade ──

describe('syncECOcascade', () => {
  it('recalculates budget when ECO is APPROVED', async () => {
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue({
      id: 'eco-1',
      projectId: PROJECT_ID,
      status: 'APPROVED',
    } as any)
    // syncBOMtoBudget internals
    prismaMock.billOfMaterial.findMany.mockResolvedValue([
      { id: 'bom-1', items: [{ quantity: 1, material: { unitPrice: 50 } }] },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncECOcascade('eco-1', USER)

    expect(prismaMock.budget.create).toHaveBeenCalled()
    // Two change events: one from syncBOMtoBudget, one from syncECOcascade
    expect(prismaMock.changeEvent.create).toHaveBeenCalledTimes(2)
  })

  it('does nothing when ECO status is not APPROVED', async () => {
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue({
      id: 'eco-1',
      projectId: PROJECT_ID,
      status: 'SUBMITTED',
    } as any)

    await syncECOcascade('eco-1', USER)

    expect(prismaMock.billOfMaterial.findMany).not.toHaveBeenCalled()
  })

  it('does nothing when ECO not found', async () => {
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue(null)

    await syncECOcascade('eco-missing', USER)

    expect(prismaMock.billOfMaterial.findMany).not.toHaveBeenCalled()
  })
})

// ── reverseStockMovement ──

describe('reverseStockMovement', () => {
  it('creates a reverse OUT movement when original was IN', async () => {
    prismaMock.stockMovement.findFirst.mockResolvedValue({
      id: 'sm-1',
      materialId: 'mat-1',
      type: 'IN',
      quantity: 100,
      referenceNo: 'P3.4A-001',
    } as any)
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await reverseStockMovement(PROJECT_ID, 'P3.4A', USER)

    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    const txArgs = prismaMock.$transaction.mock.calls[0][0]
    expect(txArgs).toHaveLength(2)
  })

  it('does nothing when no matching movement found', async () => {
    prismaMock.stockMovement.findFirst.mockResolvedValue(null)

    await reverseStockMovement(PROJECT_ID, 'P3.4A', USER)

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

// ── reverseMaterialIssue ──

describe('reverseMaterialIssue', () => {
  it('returns material to stock when work order and issue exist', async () => {
    prismaMock.workOrder.findFirst.mockResolvedValue({ id: 'wo-1' } as any)
    prismaMock.materialIssue.findFirst.mockResolvedValue({
      id: 'mi-1',
      materialId: 'mat-1',
      quantity: 50,
    } as any)
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await reverseMaterialIssue(PROJECT_ID, USER)

    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
  })

  it('does nothing when no work order found', async () => {
    prismaMock.workOrder.findFirst.mockResolvedValue(null)

    await reverseMaterialIssue(PROJECT_ID, USER)

    expect(prismaMock.materialIssue.findFirst).not.toHaveBeenCalled()
  })
})

// ── reverseDelivery ──

describe('reverseDelivery', () => {
  it('marks delivery as RETURNED', async () => {
    prismaMock.deliveryRecord.findFirst.mockResolvedValue({
      id: 'del-1',
      status: 'SHIPPED',
    } as any)
    prismaMock.deliveryRecord.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await reverseDelivery(PROJECT_ID, USER)

    expect(prismaMock.deliveryRecord.update).toHaveBeenCalledWith({
      where: { id: 'del-1' },
      data: { status: 'RETURNED', notes: 'RETURNED: SAT rejected' },
    })
  })

  it('does nothing when no delivery found', async () => {
    prismaMock.deliveryRecord.findFirst.mockResolvedValue(null)

    await reverseDelivery(PROJECT_ID, USER)

    expect(prismaMock.deliveryRecord.update).not.toHaveBeenCalled()
  })
})

// ── reverseWOstatus ──

describe('reverseWOstatus', () => {
  it('sets work order status to REWORK', async () => {
    prismaMock.workOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: 'IN_PROGRESS',
    } as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await reverseWOstatus(PROJECT_ID, USER)

    expect(prismaMock.workOrder.update).toHaveBeenCalledWith({
      where: { id: 'wo-1' },
      data: { status: 'REWORK' },
    })
  })

  it('does nothing when no matching work order found', async () => {
    prismaMock.workOrder.findFirst.mockResolvedValue(null)

    await reverseWOstatus(PROJECT_ID, USER)

    expect(prismaMock.workOrder.update).not.toHaveBeenCalled()
  })
})

// ── recalcBudgetActual ──

describe('recalcBudgetActual', () => {
  it('sums non-reversed IN movements and updates budget.actual', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { quantity: 10, material: { unitPrice: 100 } },
      { quantity: 5, material: { unitPrice: 200 } },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1' } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    // 10*100 + 5*200 = 2000
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: 2000 },
    })
  })

  it('does nothing when no budget exists', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)

    await recalcBudgetActual(PROJECT_ID, USER)

    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })
})

// ── runReverseHooks dispatcher ──

describe('runReverseHooks', () => {
  // Provide minimal stubs so recalcBudgetActual (always called) succeeds
  beforeEach(() => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
  })

  it('calls reverseStockMovement for P3.4A', async () => {
    prismaMock.stockMovement.findFirst.mockResolvedValue({
      id: 'sm-1',
      materialId: 'mat-1',
      type: 'IN',
      quantity: 10,
      referenceNo: 'P3.4A-001',
    } as any)
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await runReverseHooks(PROJECT_ID, 'P3.4A', USER, 'QC reject')

    expect(prismaMock.$transaction).toHaveBeenCalled()
  })

  it('calls reverseWOstatus for P4.6', async () => {
    prismaMock.workOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: 'IN_PROGRESS',
    } as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await runReverseHooks(PROJECT_ID, 'P4.6', USER, 'QC reject')

    expect(prismaMock.workOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'REWORK' } }),
    )
  })

  it('calls reverseDelivery for P5.3', async () => {
    prismaMock.deliveryRecord.findFirst.mockResolvedValue({
      id: 'del-1',
      status: 'SHIPPED',
    } as any)
    prismaMock.deliveryRecord.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await runReverseHooks(PROJECT_ID, 'P5.3', USER, 'SAT reject')

    expect(prismaMock.deliveryRecord.update).toHaveBeenCalled()
  })

  it('catches errors and does not throw', async () => {
    prismaMock.stockMovement.findFirst.mockRejectedValue(new Error('DB down'))
    prismaMock.stockMovement.findMany.mockRejectedValue(new Error('DB down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runReverseHooks(PROJECT_ID, 'P3.4A', USER, 'fail')).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })

  it('calls reverseMaterialIssue for P4.2', async () => {
    prismaMock.workOrder.findFirst.mockResolvedValue({ id: 'wo-1' } as any)
    prismaMock.materialIssue.findFirst.mockResolvedValue({
      id: 'mi-1',
      materialId: 'mat-1',
      quantity: 25,
    } as any)
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await runReverseHooks(PROJECT_ID, 'P4.2', USER, 'material reject')

    expect(prismaMock.$transaction).toHaveBeenCalled()
  })
})
