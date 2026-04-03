import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// GET /api/purchase-orders/[id] — PO detail with items + vendor
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: true,
      items: {
        include: { material: { select: { materialCode: true, name: true, unit: true, currentStock: true } } },
      },
    },
  })

  if (!po) return errorResponse('Không tìm thấy PO', 404)
  return successResponse({ purchaseOrder: po })
}

// PUT /api/purchase-orders/[id] — Update PO status
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const pResult2 = validateParams(await params, idParamSchema)
  if (!pResult2.success) return pResult2.response
  const { id } = pResult2.data
  const body = await req.json()
  const { action } = body as { action: string }

  const po = await prisma.purchaseOrder.findUnique({ where: { id } })
  if (!po) return errorResponse('Không tìm thấy PO', 404)

  switch (action) {
    case 'send': {
      if (po.status !== 'DRAFT' && po.status !== 'CONFIRMED') {
        return errorResponse('PO không ở trạng thái hợp lệ để gửi')
      }
      const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: 'SENT', orderDate: new Date() },
      })
      return successResponse({ purchaseOrder: updated, message: 'Đã gửi PO cho NCC' })
    }

    case 'confirm': {
      if (po.status !== 'SENT') {
        return errorResponse('PO chưa gửi, không thể xác nhận')
      }
      const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: 'CONFIRMED' },
      })
      return successResponse({ purchaseOrder: updated, message: 'NCC đã xác nhận PO' })
    }

    case 'cancel': {
      if (['RECEIVED', 'CANCELLED'].includes(po.status)) {
        return errorResponse('Không thể hủy PO đã nhận hoặc đã hủy')
      }
      const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
      })
      return successResponse({ purchaseOrder: updated, message: 'Đã hủy PO' })
    }

    default:
      return errorResponse('Action không hợp lệ')
  }
}
