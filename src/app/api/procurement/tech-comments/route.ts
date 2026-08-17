import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/tech-comments?prId=<id>
 * [PORT Thương Mại — F2] Lấy tất cả thread làm rõ kỹ thuật của 1 PR (mỗi dòng vật tư = 1 thread).
 * Bám listThreadsByPR: trả rows + summary. threadStatus suy từ comment mới nhất (rỗng → PENDING).
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const prId = req.nextUrl.searchParams.get('prId')
    if (!prId) return errorResponse('Thiếu prId', 400)

    const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId }, select: { prCode: true, urgency: true } })
    if (!pr) return errorResponse('Không tìm thấy PR', 404)

    const details = await prisma.purchaseRequestItem.findMany({
      where: { prId },
      orderBy: { itemCode: 'asc' },
      select: {
        id: true, itemCode: true, description: true, profile: true, grade: true, unit: true, reqQty: true, toBuyQty: true,
        techComments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, content: true, commentType: true, threadStatus: true, tags: true, authorId: true, createdAt: true, updatedAt: true,
            author: { select: { id: true, fullName: true, roleCode: true } },
          },
        },
      },
    })

    const rows = details.map(d => {
      const comments = d.techComments || []
      const latest = comments[comments.length - 1] || null
      const threadStatus = comments.length === 0 ? 'PENDING' : (latest?.threadStatus || 'PENDING')
      const mapC = (c: (typeof comments)[number]) => ({
        id: c.id, content: c.content, commentType: c.commentType, threadStatus: c.threadStatus, tags: c.tags,
        authorId: c.authorId, authorName: c.author?.fullName || 'Không rõ', authorRole: c.author?.roleCode || '',
        createdAt: c.createdAt, updatedAt: c.updatedAt,
      })
      return {
        prDetailId: d.id, itemCode: d.itemCode || '', itemName: d.description || '', profile: d.profile || '', grade: d.grade || '', uom: d.unit || '',
        reqQty: Number(d.reqQty || 0), toBuyQty: Number(d.toBuyQty || 0), urgency: pr.urgency || 'NORMAL',
        commentCount: comments.length, threadStatus,
        latestComment: latest ? mapC(latest) : null,
        comments: comments.map(mapC),
      }
    })

    const cnt = (s: string) => rows.filter(r => r.threadStatus === s).length
    const summary = {
      total: rows.length,
      pending: rows.filter(r => r.threadStatus === 'PENDING' && r.commentCount === 0).length,
      inDiscussion: cnt('IN_DISCUSSION'),
      clarified: cnt('CLARIFIED'),
      substitutionRequested: cnt('SUBSTITUTION_REQUESTED'),
      approved: cnt('APPROVED'),
      rejected: cnt('REJECTED'),
      readyForRFQ: rows.filter(r => ['CLARIFIED', 'APPROVED', 'PENDING'].includes(r.threadStatus)).length,
    }

    return successResponse({ prId, prCode: pr.prCode, summary, rows })
  } catch (err) {
    console.error('GET tech-comments error:', err)
    return errorResponse('Lỗi tải làm rõ kỹ thuật', 500)
  }
}
