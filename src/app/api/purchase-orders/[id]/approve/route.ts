import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { recalcPOTotal, syncPOtoBudget } from '@/lib/sync-engine'

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

    if (action === 'APPROVE') {
      try {
        await recalcPOTotal(id)
        if (po.projectId) await syncPOtoBudget(po.projectId, id, user.userId)
      } catch (e) { console.error('[approve] sync error:', e) }
    }

    // PO-Gate: báo kết quả duyệt — APPROVE → kế toán (R08/R08a) có thể thanh toán;
    // REJECT → báo người tạo PO. Lỗi notify không được chặn kết quả duyệt.
    try {
      if (action === 'APPROVE') {
        const accountants = await prisma.user.findMany({
          where: { roleCode: { in: ['R08', 'R08a'] }, isActive: true },
          select: { id: true },
        })
        if (accountants.length > 0) {
          await prisma.notification.createMany({
            data: accountants.map(u => ({
              userId: u.id,
              title: `PO đã duyệt: ${po.poCode}`,
              message: `PO ${po.poCode} đã được duyệt — có thể xử lý thanh toán/giải ngân tại tab Thanh toán.`,
              type: 'po_approved',
              linkUrl: '/dashboard/finance/payments',
            })),
          })
        }
      } else {
        await prisma.notification.create({
          data: {
            userId: po.createdBy,
            title: `PO bị từ chối: ${po.poCode}`,
            message: `PO ${po.poCode} bị từ chối duyệt${comment ? ` — lý do: ${comment}` : ''}.`,
            type: 'po_rejected',
            linkUrl: '/dashboard/warehouse/purchase-orders',
          },
        })
      }
    } catch (e) { console.error('[approve] notify error:', e) }

    await logAudit(user.userId, action, 'PurchaseOrder', id, { poCode: po.poCode, status: newStatus }, getClientIP(req))

    return successResponse({ purchaseOrder: updated }, `PO đã ${action === 'APPROVE' ? 'được duyệt' : 'bị từ chối'}`)
  } catch (err) {
    console.error('POST /api/purchase-orders/[id]/approve error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
