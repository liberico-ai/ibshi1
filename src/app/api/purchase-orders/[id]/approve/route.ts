import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// POST /api/purchase-orders/[id]/approve — Approve or reject a PO
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!['R01', 'R07'].includes(user.roleCode)) {
      return errorResponse('Chỉ R01/R07 được duyệt PO', 403)
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const body = await req.json()
    const { action, comment } = body

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return errorResponse('Action phải là APPROVE hoặc REJECT')
    }

    const po = await prisma.purchaseOrder.findUnique({ where: { id } })
    if (!po) return errorResponse('PO không tồn tại', 404)
    if (po.status !== 'DRAFT' && po.status !== 'PENDING') {
      return errorResponse(`PO đã ở trạng thái ${po.status}`)
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        notes: comment ? `${po.notes || ''}\n[${action} by ${user.userId}] ${comment}`.trim() : po.notes,
      },
    })

    await logAudit(user.userId, action, 'PurchaseOrder', id, { poCode: po.poCode, status: newStatus }, getClientIP(req))

    return successResponse({ purchaseOrder: updated }, `PO đã ${action === 'APPROVE' ? 'được duyệt' : 'bị từ chối'}`)
  } catch (err) {
    console.error('POST /api/purchase-orders/[id]/approve error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
