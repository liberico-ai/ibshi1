import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

vi.mock('@/lib/db', () => ({ default: prismaMock }))

import { applyStockMovement, resolveWarehouseId } from '@/lib/stock-ledger'

const WH_COMMON = { id: 'wh-vcnd', code: 'VCND', name: 'Vật liệu chính nội địa', kind: 'COMMON' }

describe('resolveWarehouseId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns provided warehouseId when given', async () => {
    const id = await resolveWarehouseId(prismaMock as any, 'wh-123')
    expect(id).toBe('wh-123')
    expect(prismaMock.warehouse.findUnique).not.toHaveBeenCalled()
  })

  it('finds VCND warehouse as fallback', async () => {
    prismaMock.warehouse.findUnique.mockResolvedValue(WH_COMMON as any)
    const id = await resolveWarehouseId(prismaMock as any)
    expect(id).toBe('wh-vcnd')
    expect(prismaMock.warehouse.findUnique).toHaveBeenCalledWith({ where: { code: 'VCND' } })
  })

  it('creates VCND warehouse if not found', async () => {
    prismaMock.warehouse.findUnique.mockResolvedValue(null)
    prismaMock.warehouse.create.mockResolvedValue({ ...WH_COMMON, id: 'wh-new' } as any)
    const id = await resolveWarehouseId(prismaMock as any)
    expect(id).toBe('wh-new')
    expect(prismaMock.warehouse.create).toHaveBeenCalledWith({
      data: { code: 'VCND', name: 'Vật liệu chính nội địa', kind: 'COMMON' },
    })
  })
})

describe('applyStockMovement', () => {
  beforeEach(() => vi.clearAllMocks())

  const MOVEMENT = {
    id: 'mv-1',
    materialId: 'mat-1',
    warehouseId: 'wh-vcnd',
    type: 'IN',
    quantity: 50,
    reason: 'po_receipt',
  }

  it('IN: creates movement + upserts MaterialStock + increments currentStock', async () => {
    prismaMock.warehouse.findUnique.mockResolvedValue(WH_COMMON as any)
    prismaMock.stockMovement.create.mockResolvedValue(MOVEMENT as any)
    prismaMock.materialStock.upsert.mockResolvedValue({} as any)
    prismaMock.material.update.mockResolvedValue({} as any)

    const result = await applyStockMovement(prismaMock as any, {
      materialId: 'mat-1',
      type: 'IN',
      quantity: 50,
      reason: 'po_receipt',
      performedBy: 'user-1',
    })

    expect(result).toEqual(MOVEMENT)

    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        materialId: 'mat-1',
        warehouseId: 'wh-vcnd',
        type: 'IN',
        quantity: 50,
      }),
    })

    expect(prismaMock.materialStock.upsert).toHaveBeenCalledWith({
      where: { materialId_warehouseId: { materialId: 'mat-1', warehouseId: 'wh-vcnd' } },
      create: { materialId: 'mat-1', warehouseId: 'wh-vcnd', quantity: 50 },
      update: { quantity: { increment: 50 } },
    })

    expect(prismaMock.material.update).toHaveBeenCalledWith({
      where: { id: 'mat-1' },
      data: { currentStock: { increment: 50 } },
    })
  })

  it('OUT: decrements MaterialStock and currentStock', async () => {
    prismaMock.warehouse.findUnique.mockResolvedValue(WH_COMMON as any)
    prismaMock.stockMovement.create.mockResolvedValue({ ...MOVEMENT, type: 'OUT' } as any)
    prismaMock.materialStock.upsert.mockResolvedValue({} as any)
    prismaMock.material.update.mockResolvedValue({} as any)

    await applyStockMovement(prismaMock as any, {
      materialId: 'mat-1',
      type: 'OUT',
      quantity: 30,
      reason: 'production_issue',
      performedBy: 'user-1',
    })

    expect(prismaMock.materialStock.upsert).toHaveBeenCalledWith({
      where: { materialId_warehouseId: { materialId: 'mat-1', warehouseId: 'wh-vcnd' } },
      create: { materialId: 'mat-1', warehouseId: 'wh-vcnd', quantity: -30 },
      update: { quantity: { increment: -30 } },
    })

    expect(prismaMock.material.update).toHaveBeenCalledWith({
      where: { id: 'mat-1' },
      data: { currentStock: { increment: -30 } },
    })
  })

  it('uses explicit warehouseId when provided', async () => {
    prismaMock.stockMovement.create.mockResolvedValue(MOVEMENT as any)
    prismaMock.materialStock.upsert.mockResolvedValue({} as any)
    prismaMock.material.update.mockResolvedValue({} as any)

    await applyStockMovement(prismaMock as any, {
      materialId: 'mat-1',
      warehouseId: 'wh-custom',
      type: 'IN',
      quantity: 10,
      reason: 'manual',
      performedBy: 'user-1',
    })

    expect(prismaMock.warehouse.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ warehouseId: 'wh-custom' }),
    })
  })

  it('passes optional fields (heatNumber, lotNumber, poItemId, referenceNo)', async () => {
    prismaMock.warehouse.findUnique.mockResolvedValue(WH_COMMON as any)
    prismaMock.stockMovement.create.mockResolvedValue(MOVEMENT as any)
    prismaMock.materialStock.upsert.mockResolvedValue({} as any)
    prismaMock.material.update.mockResolvedValue({} as any)

    await applyStockMovement(prismaMock as any, {
      materialId: 'mat-1',
      type: 'IN',
      quantity: 5,
      reason: 'po_receipt',
      referenceNo: 'PO-001',
      poItemId: 'poi-1',
      heatNumber: 'H123',
      lotNumber: 'L456',
      performedBy: 'user-1',
      notes: 'test note',
    })

    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referenceNo: 'PO-001',
        poItemId: 'poi-1',
        heatNumber: 'H123',
        lotNumber: 'L456',
        notes: 'test note',
      }),
    })
  })
})
