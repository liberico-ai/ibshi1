import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/tasks/[id]/comments — List comments for a task
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params

  const comments = await prisma.auditLog.findMany({
    where: { entityId: id, entity: 'TASK_COMMENT' },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ comments })
}

// POST /api/tasks/[id]/comments — Add comment to task
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params
  const body = await req.json()
  const { content } = body

  if (!content || !content.trim()) return errorResponse('Nội dung bình luận không được trống')

  const task = await prisma.workflowTask.findUnique({ where: { id } })
  if (!task) return errorResponse('Không tìm thấy task', 404)

  const comment = await prisma.auditLog.create({
    data: {
      entityId: id,
      entity: 'TASK_COMMENT',
      action: 'COMMENT',
      userId: user.userId,
      changes: { content: content.trim(), userName: user.fullName },
    },
  })

  return successResponse({ comment, message: 'Đã thêm bình luận' })
}
