import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// POST /api/purchase-requests/[id]/approve — Approve or reject a PR
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!['R01', 'R02', 'R07'].includes(user.roleCode)) {
      return errorResponse('Bạn không có quyền duyệt PR', 403)
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const body = await req.json()
    const { action, comment } = body // action: 'APPROVE' | 'REJECT'

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return errorResponse('Action phải là APPROVE hoặc REJECT')
    }

    const pr = await prisma.purchaseRequest.findUnique({ where: { id } })
    if (!pr) return errorResponse('PR không tồn tại', 404)
    if (pr.status !== 'PENDING' && pr.status !== 'DRAFT') {
      return errorResponse(`PR đã ở trạng thái ${pr.status}, không thể duyệt`)
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    const updated = await prisma.purchaseRequest.update({
      where: { id },
      data: {
        status: newStatus,
        approvedBy: user.userId,
        approvedAt: new Date(),
        notes: comment ? `${pr.notes || ''}\n[${action}] ${comment}`.trim() : pr.notes,
      },
    })

    await logAudit(user.userId, action, 'PurchaseRequest', id, { prCode: pr.prCode, status: newStatus }, getClientIP(req))

    return successResponse({ purchaseRequest: updated }, `PR đã ${action === 'APPROVE' ? 'được duyệt' : 'bị từ chối'}`)
  } catch (err) {
    console.error('POST /api/purchase-requests/[id]/approve error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
