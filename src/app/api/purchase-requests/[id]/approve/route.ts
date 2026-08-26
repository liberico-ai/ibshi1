import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { notifyRole } from '@/lib/notify-role'

export const dynamic = 'force-dynamic'
// QT19 bước 3: phê duyệt yêu cầu mua — TP Thương mại (R07) / GĐ dự án (R02) / BGĐ (R01) / Admin.
const APPROVE_ROLES = ['R07', 'R02', 'R01', 'R10']
const SUBMIT_ROLES = ['R03', 'R03a', 'R04', 'R04a', 'R05', 'R05a', 'R07', 'R07a', 'R02', 'R02a', 'R01', 'R10']

/**
 * POST /api/purchase-requests/[id]/approve — QT19 bước 3: duyệt yêu cầu mua trước khi tách RFQ.
 * action: submit (DRAFT→PENDING) | approve (PENDING→APPROVED) | reject (PENDING→REJECTED).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { action?: string; reason?: string }
    const action = String(body.action || '')

    const pr = await prisma.purchaseRequest.findUnique({ where: { id }, select: { id: true, prCode: true, status: true } })
    if (!pr) return errorResponse('Không tìm thấy PR', 404)

    if (action === 'submit') {
      if (!SUBMIT_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền trình duyệt PR', 403)
      if (pr.status === 'APPROVED') return errorResponse('PR đã được duyệt', 409)
      await prisma.purchaseRequest.update({ where: { id }, data: { status: 'PENDING', submittedAt: new Date(), prRejectReason: null, prRejectedBy: null } })
      await logAudit(payload.userId, 'PR_SUBMIT', 'PurchaseRequest', id, { prCode: pr.prCode }, getClientIP(req))
      await notifyRole(APPROVE_ROLES, { title: `PR ${pr.prCode} chờ duyệt`, message: `Yêu cầu mua ${pr.prCode} cần TP Thương mại / GĐ dự án duyệt.`, linkUrl: '/dashboard/warehouse/kiem-tra-ton-kho', excludeUserId: payload.userId })
      return successResponse({ id, status: 'PENDING' }, `Đã trình duyệt PR ${pr.prCode}`)
    }
    if (action === 'approve') {
      if (!APPROVE_ROLES.includes(payload.roleCode)) return errorResponse('Chỉ TP Thương mại / GĐ dự án / BGĐ được duyệt PR', 403)
      await prisma.purchaseRequest.update({ where: { id }, data: { status: 'APPROVED', approvedBy: payload.userId, approvedAt: new Date() } })
      await logAudit(payload.userId, 'PR_APPROVE', 'PurchaseRequest', id, { prCode: pr.prCode }, getClientIP(req))
      return successResponse({ id, status: 'APPROVED' }, `Đã duyệt PR ${pr.prCode} — có thể tách RFQ`)
    }
    if (action === 'reject') {
      if (!APPROVE_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền từ chối PR', 403)
      const reason = String(body.reason || '').trim()
      if (!reason) return errorResponse('Cần nhập lý do từ chối', 400)
      await prisma.purchaseRequest.update({ where: { id }, data: { status: 'REJECTED', prRejectReason: reason, prRejectedBy: payload.userId } })
      await logAudit(payload.userId, 'PR_REJECT', 'PurchaseRequest', id, { prCode: pr.prCode, reason }, getClientIP(req))
      return successResponse({ id, status: 'REJECTED' }, `Đã từ chối PR ${pr.prCode}`)
    }
    return errorResponse('action không hợp lệ (submit | approve | reject)', 400)
  } catch (err) {
    console.error('POST pr approve error:', err)
    return errorResponse('Lỗi duyệt PR', 500)
  }
}
