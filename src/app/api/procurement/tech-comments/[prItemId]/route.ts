import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const COMMENT_TYPES = ['QUESTION', 'ANSWER', 'SUBSTITUTION_REQUEST', 'APPROVAL', 'REJECTION', 'NOTE']
const THREAD_STATUSES = ['PENDING', 'IN_DISCUSSION', 'CLARIFIED', 'SUBSTITUTION_REQUESTED', 'APPROVED', 'REJECTED']

/**
 * POST /api/procurement/tech-comments/[prItemId]  body: { content, commentType?, threadStatus?, tags? }
 * [PORT Thương Mại — F2] Thêm 1 comment vào thread làm rõ kỹ thuật của 1 dòng vật tư (bám addComment).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ prItemId: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { prItemId } = await params

    const body = await req.json().catch(() => ({})) as { content?: string; commentType?: string; threadStatus?: string; tags?: string }
    const content = String(body.content || '').trim()
    if (!content) return errorResponse('Nội dung không được để trống', 400)

    const item = await prisma.purchaseRequestItem.findUnique({ where: { id: prItemId }, select: { id: true } })
    if (!item) return errorResponse('Không tìm thấy dòng vật tư', 404)

    const commentType = COMMENT_TYPES.includes(body.commentType || '') ? body.commentType! : 'NOTE'
    const threadStatus = THREAD_STATUSES.includes(body.threadStatus || '') ? body.threadStatus! : null

    const c = await prisma.techComment.create({
      data: { prItemId, authorId: payload.userId, content, commentType, threadStatus, tags: body.tags || null },
      select: {
        id: true, prItemId: true, content: true, commentType: true, threadStatus: true, tags: true, authorId: true, createdAt: true,
        author: { select: { fullName: true, roleCode: true } },
      },
    })

    return successResponse({
      id: c.id, prDetailId: c.prItemId, content: c.content, commentType: c.commentType, threadStatus: c.threadStatus, tags: c.tags,
      authorId: c.authorId, authorName: c.author?.fullName || 'Không rõ', authorRole: c.author?.roleCode || '', createdAt: c.createdAt,
    }, 'Đã gửi trao đổi', 201)
  } catch (err) {
    console.error('POST tech-comment error:', err)
    return errorResponse('Lỗi gửi trao đổi', 500)
  }
}
