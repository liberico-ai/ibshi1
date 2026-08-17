import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const THREAD_STATUSES = ['PENDING', 'IN_DISCUSSION', 'CLARIFIED', 'SUBSTITUTION_REQUESTED', 'APPROVED', 'REJECTED']
const TYPE_MAP: Record<string, string> = {
  APPROVED: 'APPROVAL', REJECTED: 'REJECTION', CLARIFIED: 'ANSWER', SUBSTITUTION_REQUESTED: 'SUBSTITUTION_REQUEST',
}

/**
 * PATCH /api/procurement/tech-comments/[prItemId]/status  body: { threadStatus, note? }
 * [PORT Thương Mại — F2] Cập nhật trạng thái thread — tự ghi 1 comment hệ thống ghi nhận (bám updateThreadStatus).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ prItemId: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { prItemId } = await params

    const body = await req.json().catch(() => ({})) as { threadStatus?: string; note?: string }
    const threadStatus = String(body.threadStatus || '')
    if (!THREAD_STATUSES.includes(threadStatus)) return errorResponse('threadStatus không hợp lệ', 400)

    const item = await prisma.purchaseRequestItem.findUnique({ where: { id: prItemId }, select: { id: true } })
    if (!item) return errorResponse('Không tìm thấy dòng vật tư', 404)

    const commentType = TYPE_MAP[threadStatus] || 'NOTE'
    const content = String(body.note || '').trim() || `Trạng thái cập nhật: ${threadStatus}`
    const c = await prisma.techComment.create({
      data: { prItemId, authorId: payload.userId, content, commentType, threadStatus, tags: null },
      select: { id: true },
    })

    return successResponse({ newStatus: threadStatus, commentId: c.id }, 'Đã cập nhật trạng thái')
  } catch (err) {
    console.error('PATCH tech-comment status error:', err)
    return errorResponse('Lỗi cập nhật trạng thái', 500)
  }
}
