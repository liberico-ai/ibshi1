import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createGrnSchema } from '@/lib/schemas'

// GET /api/grn — List goods received (stock movements with type=IN, reason=po_receipt)
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const poCode = url.searchParams.get('poCode') || undefined

  const where: Record<string, unknown> = {
    type: 'IN',
    reason: 'po_receipt',
  }

  if (poCode) {
    where.referenceNo = { contains: poCode }
  }

  const [total, movements] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: {
        material: { select: { materialCode: true, name: true, unit: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return successResponse({
    receipts: movements,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

// POST /api/grn — Receive goods against a PO
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R02', 'R05', 'R05a', 'R07'])) {
    return errorResponse('Không có quyền nhận hàng', 403)
  }

  const validation = await validateBody(req, createGrnSchema)
  if (!validation.success) return validation.response
  const { poId, items } = validation.data

  // Validate PO exists and is in receivable state
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: { items: { include: { material: true } } },
  })

  if (!po) return errorResponse('Không tìm thấy PO')
  if (['CANCELLED', 'DRAFT'].includes(po.status)) {
    return errorResponse('PO chưa gửi hoặc đã hủy')
  }

  // Process each item in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const movements = []

    for (const item of items) {
      const poItem = po.items.find(i => i.id === item.poItemId)
      if (!poItem) continue
      if (item.receivedQty <= 0) continue

      const newReceivedQty = Number(poItem.receivedQty) + item.receivedQty

      // Update PO item received qty
      await tx.purchaseOrderItem.update({
        where: { id: item.poItemId },
        data: { receivedQty: newReceivedQty },
      })

      // Update material stock
      await tx.material.update({
        where: { id: poItem.materialId },
        data: { currentStock: { increment: item.receivedQty } },
      })

      // Create stock movement record
      const movement = await tx.stockMovement.create({
        data: {
          materialId: poItem.materialId,
          type: 'IN',
          reason: 'po_receipt',
          quantity: item.receivedQty,
          referenceNo: po.poCode,
          poItemId: item.poItemId,
          heatNumber: item.heatNumber || null,
          lotNumber: item.lotNumber || null,
          performedBy: user.userId,
          notes: item.notes || `Nhận hàng từ ${po.poCode}`,
        },
      })
      movements.push(movement)
    }

    // Check if all PO items are fully received
    const updatedPO = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    })

    const allReceived = updatedPO!.items.every(i => Number(i.receivedQty) >= Number(i.quantity))
    const someReceived = updatedPO!.items.some(i => Number(i.receivedQty) > 0)

    const newStatus = allReceived ? 'RECEIVED' : someReceived ? 'PARTIAL_RECEIVED' : po.status

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: newStatus },
    })

    return { movements, poStatus: newStatus }
  })

  return successResponse({
    message: `Đã nhận ${result.movements.length} mục`,
    movements: result.movements,
    poStatus: result.poStatus,
  })
}
