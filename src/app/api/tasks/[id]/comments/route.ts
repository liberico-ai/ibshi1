import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { taskCommentSchema, idParamSchema } from '@/lib/schemas'
import { addComment } from '@/lib/work-engine'

// GET /api/tasks/[id]/comments — List comments for a task
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data

  const entries = await prisma.taskHistory.findMany({
    where: { taskId: id, action: 'COMMENT' },
    orderBy: { createdAt: 'desc' },
  })

  const userIds = [...new Set(entries.map(e => e.byUserId))]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  const comments = entries.map(e => ({
    id: e.id,
    createdAt: e.createdAt,
    userId: e.byUserId,
    changes: { content: e.reason || '', userName: nameById.get(e.byUserId) || 'Người dùng' },
  }))

  return successResponse({ comments })
}

// POST /api/tasks/[id]/comments — Add comment to task (assignee/creator only)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data
  const result = await validateBody(req, taskCommentSchema)
  if (!result.success) return result.response
  const { content } = result.data

  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, createdBy: true, assignees: { select: { userId: true, role: true } } },
  })
  if (!task) return errorResponse('Không tìm thấy task', 404)

  const isAssignee = task.createdBy === user.userId
    || task.assignees.some(a => a.userId === user.userId || a.role === user.roleCode)
    || user.roleCode === 'R01'
  if (!isAssignee) return errorResponse('Bạn không thuộc task này', 403)

  const entry = await addComment(id, user.userId, content.trim())

  const comment = {
    id: entry.id,
    createdAt: entry.createdAt,
    userId: entry.byUserId,
    changes: { content: entry.reason || '', userName: user.fullName },
  }

  return successResponse({ comment, message: 'Đã thêm bình luận' })
}