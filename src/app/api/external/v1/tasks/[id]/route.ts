import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:tasks')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const { id } = await params

  const task = await prisma.task.findFirst({
    where: { OR: [{ id }, { externalRef: id }] },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      assignees: true,
    },
  })

  if (!task) return errorResponse('Task not found', 404, 'NOT_FOUND')

  const userIds = task.assignees.map(a => a.userId).filter((uid): uid is string => !!uid)
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  const rd = (task.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
  const briefing = (rd.briefing && typeof rd.briefing === 'object') ? (rd.briefing as Record<string, unknown>) : {}
  const decision = typeof briefing.decision === 'string' ? briefing.decision : ''

  const data = {
    taskId: task.id,
    externalRef: task.externalRef || null,
    projectCode: task.project?.projectCode || null,
    projectName: task.project?.projectName || null,
    title: task.title,
    status: task.status,
    blocked: task.blocked,
    priority: task.priority || 'NORMAL',
    assignees: task.assignees.map(a => ({
      userId: a.userId || null,
      fullName: a.userId ? (nameById.get(a.userId) || null) : null,
      roleCode: a.role,
    })),
    deadline: task.deadline,
    decision,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt || null,
  }

  return successResponse({ data })
}
