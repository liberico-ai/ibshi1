import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { xepHang } from '@/lib/integration/outbox'
import { daXepHangMoi } from '@/lib/integration/kich-hoat'

export const dynamic = 'force-dynamic'

// POST /api/procurement/commerce-approvals/[id]/decide
// body: { decision: 'APPROVE' | 'REJECT', reason?: string }
//
// BGĐ duyệt hoặc trả lại một đợt báo giá của Thương mại. Đây là điểm DUY NHẤT ERP ghi vào
// bảng gương — và quyết định ghi xong thì xếp hàng đẩy ngược về ibs-commerce.

/** Chỉ BGĐ quyết. Admin có trong danh sách để xử lý sự cố, không phải để duyệt thay. */
const DUOC_DUYET = ['R01', 'R10']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!DUOC_DUYET.includes(user.roleCode)) {
      return errorResponse('Chỉ BGĐ được duyệt báo giá nhà cung cấp', 403)
    }
    const { id } = await params

    const body = await req.json().catch(() => ({})) as { decision?: string; reason?: string }
    const quyet = String(body.decision || '').trim().toUpperCase()
    const lyDo = String(body.reason || '').trim()
    if (quyet !== 'APPROVE' && quyet !== 'REJECT') {
      return errorResponse("Quyết định phải là 'APPROVE' hoặc 'REJECT'", 400)
    }
    // Trả lại mà không nói lý do thì Thương mại không biết sửa gì — bắt buộc nhập.
    if (quyet === 'REJECT' && !lyDo) {
      return errorResponse('Trả lại thì phải ghi lý do để Thương mại biết đường sửa', 400)
    }

    const a = await prisma.commerceApproval.findUnique({
      where: { id },
      select: { id: true, remoteId: true, bidCode: true, projectCode: true, status: true, totalValue: true },
    })
    if (!a) return errorResponse('Không tìm thấy đợt duyệt', 404)
    if (a.status !== 'PENDING') {
      return errorResponse(`Đợt ${a.bidCode} đã được xử lý (${a.status}) — không quyết lại được`, 409)
    }

    const status = quyet === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    const now = new Date()
    await prisma.commerceApproval.update({
      where: { id },
      data: { status, decidedBy: user.userId, decidedAt: now, reason: lyDo || null },
    })

    // Xếp hàng báo về Thương mại. KHÔNG gọi thẳng: Thương mại đang sập thì BGĐ vẫn duyệt được,
    // quyết định nằm trong hộp thư đi và tự gửi lại khi hệ kia sống lại.
    await xepHang({
      event: 'approval.decided',
      entity: 'approval',
      entityId: a.id,
      payload: {
        bidId: a.remoteId,
        bidCode: a.bidCode,
        projectCode: a.projectCode,
        decision: status,
        reason: lyDo || null,
        decidedBy: user.fullName || user.username,
        decidedByCode: user.userId,
        decidedAt: now.toISOString(),
      },
    })

    // Thương mại đang chờ quyết định này để phát hành đơn hàng — gửi ngay, đừng bắt họ
    // chờ tới lượt cron.
    daXepHangMoi()

    return successResponse({
      message: status === 'APPROVED'
        ? `Đã duyệt ${a.bidCode} — đang báo về Thương mại`
        : `Đã trả lại ${a.bidCode} — đang báo về Thương mại`,
      status,
    })
  } catch (err) {
    console.error('POST /api/procurement/commerce-approvals/[id]/decide error:', err)
    return errorResponse('Lỗi ghi quyết định duyệt', 500)
  }
}
