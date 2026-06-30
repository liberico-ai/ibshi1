import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/db', () => ({ default: prismaMock }))

import { reverseStockMovements } from '@/lib/sync-engine'

describe('reverseStockMovements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips when _stockReversed flag already set', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      resultData: { _stockReversed: true },
    } as any)

    const count = await reverseStockMovements('proj-1', 'P4.4', 'task-1', 'user-1')
    expect(count).toBe(0)
    expect(prismaMock.stockMovement.findMany).not.toHaveBeenCalled()
  })

  it('returns 0 when no stock movements found', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ resultData: {} } as any)
    prismaMock.project.findUnique.mockResolvedValue({ projectCode: 'PROJ-001' } as any)
    prismaMock.stockMovement.findMany.mockResolvedValue([])

    const count = await reverseStockMovements('proj-1', 'P4.4', 'task-1', 'user-1')
    expect(count).toBe(0)
  })

  it('creates compensating movements for each original', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ resultData: {} } as any)
    prismaMock.project.findUnique.mockResolvedValue({ projectCode: 'PROJ-001' } as any)

    const origMovements = [
      { id: 'mv-1', materialId: 'mat-1', warehouseId: 'wh-1', projectId: 'proj-1', type: 'IN', quantity: 100, reason: 'warehouse_receipt' },
      { id: 'mv-2', materialId: 'mat-2', warehouseId: 'wh-1', projectId: 'proj-1', type: 'IN', quantity: 50, reason: 'warehouse_receipt' },
    ]

    prismaMock.stockMovement.findMany
      .mockResolvedValueOnce(origMovements as any)
      .mockResolvedValueOnce([]) // no existing reversals

    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
    prismaMock.stockMovement.create.mockResolvedValue({} as any)
    prismaMock.materialStock.upsert.mockResolvedValue({} as any)
    prismaMock.material.update.mockResolvedValue({} as any)
    prismaMock.warehouse.findUnique.mockResolvedValue({ id: 'wh-1' } as any)
    prismaMock.task.update.mockResolvedValue({} as any)
    prismaMock.materialStock.findMany.mockResolvedValue([])

    const count = await reverseStockMovements('proj-1', 'P4.4', 'task-1', 'user-1')
    expect(count).toBe(2)

    // Check the first reversal is OUT (compensating IN)
    const createCalls = prismaMock.stockMovement.create.mock.calls
    expect(createCalls[0][0].data).toMatchObject({
      materialId: 'mat-1',
      type: 'OUT',
      quantity: 100,
      reason: 'reverse_warehouse_receipt',
      referenceNo: 'REV-PROJ-001-P4.4',
    })

    // _stockReversed flag set on task
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { resultData: { _stockReversed: true } },
    })
  })

  it('skips already-reversed movements (idempotent)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ resultData: {} } as any)
    prismaMock.project.findUnique.mockResolvedValue({ projectCode: 'PROJ-001' } as any)

    prismaMock.stockMovement.findMany
      .mockResolvedValueOnce([
        { id: 'mv-1', materialId: 'mat-1', warehouseId: 'wh-1', projectId: 'proj-1', type: 'IN', quantity: 100, reason: 'po_receipt' },
      ] as any)
      .mockResolvedValueOnce([
        { notes: 'Đảo ngược reject P4.4, orig:mv-1' },
      ] as any) // already has reversal for mv-1

    const count = await reverseStockMovements('proj-1', 'P4.4', 'task-1', 'user-1')
    expect(count).toBe(0)
  })

  it('reverses P4.5 OUT movements back to IN', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ resultData: {} } as any)
    prismaMock.project.findUnique.mockResolvedValue({ projectCode: 'PROJ-001' } as any)

    prismaMock.stockMovement.findMany
      .mockResolvedValueOnce([
        { id: 'mv-out', materialId: 'mat-1', warehouseId: 'wh-1', projectId: 'proj-1', type: 'OUT', quantity: 30, reason: 'production_issue' },
      ] as any)
      .mockResolvedValueOnce([]) // no existing reversals

    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
    prismaMock.stockMovement.create.mockResolvedValue({} as any)
    prismaMock.materialStock.upsert.mockResolvedValue({} as any)
    prismaMock.material.update.mockResolvedValue({} as any)
    prismaMock.warehouse.findUnique.mockResolvedValue({ id: 'wh-1' } as any)
    prismaMock.task.update.mockResolvedValue({} as any)
    prismaMock.materialStock.findMany.mockResolvedValue([])

    const count = await reverseStockMovements('proj-1', 'P4.5', 'task-1', 'user-1')
    expect(count).toBe(1)

    const createCall = prismaMock.stockMovement.create.mock.calls[0][0].data
    expect(createCall).toMatchObject({
      type: 'IN',
      quantity: 30,
      reason: 'reverse_production_issue',
      referenceNo: 'REV-PROJ-001-P4.5',
    })
  })

  it('warns on negative stock after reversal', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ resultData: {} } as any)
    prismaMock.project.findUnique.mockResolvedValue({ projectCode: 'PROJ-001' } as any)

    prismaMock.stockMovement.findMany
      .mockResolvedValueOnce([
        { id: 'mv-1', materialId: 'mat-1', warehouseId: 'wh-1', projectId: 'proj-1', type: 'IN', quantity: 100, reason: 'po_receipt' },
      ] as any)
      .mockResolvedValueOnce([])

    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
    prismaMock.stockMovement.create.mockResolvedValue({} as any)
    prismaMock.materialStock.upsert.mockResolvedValue({} as any)
    prismaMock.material.update.mockResolvedValue({} as any)
    prismaMock.warehouse.findUnique.mockResolvedValue({ id: 'wh-1' } as any)
    prismaMock.task.update.mockResolvedValue({} as any)

    // Return negative stock
    prismaMock.materialStock.findMany.mockResolvedValue([
      { quantity: -50, material: { materialCode: 'ST-001' }, warehouse: { code: 'VCND' } },
    ] as any)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await reverseStockMovements('proj-1', 'P3.4', 'task-1', 'user-1')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Tồn âm'))
    warnSpy.mockRestore()
  })
})
