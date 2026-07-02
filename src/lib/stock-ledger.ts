import { Prisma } from '@prisma/client'

// ── Types ──

export interface StockMovementInput {
  materialId: string
  warehouseId?: string | null
  projectId?: string | null
  type: 'IN' | 'OUT' | 'RETURN' | 'ADJUSTMENT'
  quantity: number
  reason: string
  referenceNo?: string | null
  poItemId?: string | null
  performedBy: string
  notes?: string | null
  heatNumber?: string | null
  lotNumber?: string | null
  millCertificateId?: string | null
}

type Tx = Prisma.TransactionClient

const COMMON_WAREHOUSE_CODE = 'VCND'

// ── Ensure fallback warehouse ──

export async function resolveWarehouseId(tx: Tx, warehouseId?: string | null): Promise<string> {
  if (warehouseId) return warehouseId
  const wh = await tx.warehouse.findUnique({ where: { code: COMMON_WAREHOUSE_CODE } })
  if (wh) return wh.id
  const created = await tx.warehouse.create({
    data: { code: COMMON_WAREHOUSE_CODE, name: 'Vật liệu chính nội địa', kind: 'COMMON' },
  })
  return created.id
}

// ── Central stock write helper ──

export async function applyStockMovement(tx: Tx, input: StockMovementInput) {
  const whId = await resolveWarehouseId(tx, input.warehouseId)
  const qty = Math.abs(input.quantity)
  const sign = input.type === 'OUT' ? -1 : 1

  const movement = await tx.stockMovement.create({
    data: {
      materialId: input.materialId,
      warehouseId: whId,
      projectId: input.projectId || null,
      type: input.type,
      quantity: qty,
      reason: input.reason,
      referenceNo: input.referenceNo || null,
      poItemId: input.poItemId || null,
      performedBy: input.performedBy,
      notes: input.notes || null,
      heatNumber: input.heatNumber || null,
      lotNumber: input.lotNumber || null,
      millCertificateId: input.millCertificateId || null,
    },
  })

  await tx.materialStock.upsert({
    where: { materialId_warehouseId: { materialId: input.materialId, warehouseId: whId } },
    create: { materialId: input.materialId, warehouseId: whId, quantity: sign * qty },
    update: { quantity: { increment: sign * qty } },
  })

  await tx.material.update({
    where: { id: input.materialId },
    data: { currentStock: { increment: sign * qty } },
  })

  return movement
}
