import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'

// GET /api/delivery — list deliveries
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (status) where.status = status

    const deliveries = await prisma.deliveryRecord.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        workOrder: { select: { woCode: true, description: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return successResponse({ deliveries })
  } catch (err) {
    console.error('GET /api/delivery error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/delivery — create delivery record
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!['R01', 'R06', 'R07'].includes(user.roleCode)) {
      return errorResponse('Bạn không có quyền tạo phiếu giao hàng', 403)
    }

    const body = await req.json()
    const { projectId, workOrderId, packingList, shippingMethod, notes } = body

    if (!projectId) return errorResponse('Thiếu mã dự án')

    const count = await prisma.deliveryRecord.count()
    const deliveryCode = `DL-${String(count + 1).padStart(5, '0')}`

    const delivery = await prisma.deliveryRecord.create({
      data: {
        deliveryCode,
        projectId,
        workOrderId: workOrderId || null,
        packingList: packingList || null,
        shippingMethod: shippingMethod || null,
        notes,
        createdBy: user.userId,
      },
    })

    await logAudit(user.userId, 'CREATE', 'DeliveryRecord', delivery.id, { deliveryCode, projectId }, getClientIP(req))

    return successResponse({ delivery }, `Phiếu giao hàng ${deliveryCode} đã tạo`, 201)
  } catch (err) {
    console.error('POST /api/delivery error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PATCH /api/delivery — update delivery status
export async function PATCH(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { id, status, trackingNo, receivedBy } = body

    if (!id) return errorResponse('Thiếu ID')

    const validTransitions: Record<string, string[]> = {
      PACKING: ['SHIPPED'],
      SHIPPED: ['DELIVERED'],
      DELIVERED: ['RECEIVED'],
    }

    const delivery = await prisma.deliveryRecord.findUnique({ where: { id } })
    if (!delivery) return errorResponse('Phiếu không tồn tại', 404)

    if (status && validTransitions[delivery.status] && !validTransitions[delivery.status].includes(status)) {
      return errorResponse(`Không thể chuyển từ ${delivery.status} → ${status}`)
    }

    const updated = await prisma.deliveryRecord.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(status === 'SHIPPED' ? { shippedAt: new Date(), trackingNo: trackingNo || delivery.trackingNo } : {}),
        ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(status === 'RECEIVED' ? { receivedBy: receivedBy || user.userId } : {}),
      },
    })

    await logAudit(user.userId, 'TRANSITION', 'DeliveryRecord', id, { from: delivery.status, to: status }, getClientIP(req))

    return successResponse({ delivery: updated })
  } catch (err) {
    console.error('PATCH /api/delivery error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
