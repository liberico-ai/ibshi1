import { NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'RETURNED', 'CANCELLED'] as const

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'RETURNED', 'CANCELLED'],
  RETURNED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
}

const bodySchema = z.object({
  status: z.enum(VALID_STATUSES),
  reason: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'write:tasks')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { return errorResponse('Invalid JSON body', 400, 'VALIDATION_FAILED') }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => i.message).join('; ')
    return errorResponse(msg, 400, 'VALIDATION_FAILED')
  }

  const { status: newStatus, reason } = parsed.data

  const task = await prisma.task.findFirst({
    where: { OR: [{ id }, { externalRef: id }] },
  })
  if (!task) return errorResponse('Task not found', 404, 'NOT_FOUND')

  if (task.externalSource !== 'sale') {
    return errorResponse('Only Sale-originated tasks can be updated via this endpoint', 403, 'FORBIDDEN')
  }

  const allowed = ALLOWED_TRANSITIONS[task.status] || []
  if (!allowed.includes(newStatus)) {
    return errorResponse(
      `Cannot transition from ${task.status} to ${newStatus}. Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
      400,
      'INVALID_TRANSITION',
    )
  }

  const previousStatus = task.status
  const now = new Date()
  const updateData: Record<string, unknown> = { status: newStatus }

  if (newStatus === 'DONE') {
    updateData.completedAt = now
    updateData.completedBy = client.id
  }
  if (newStatus === 'IN_PROGRESS' && !task.startedAt) {
    updateData.startedAt = now
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: updateData,
    select: {
      id: true, externalRef: true, status: true,
      completedAt: true, updatedAt: true,
    },
  })

  await prisma.taskHistory.create({
    data: {
      taskId: task.id,
      action: newStatus === 'DONE' ? 'COMPLETED' : newStatus === 'RETURNED' ? 'RETURNED' : 'STARTED',
      byUserId: client.id,
      reason: reason || `Status changed via external API: ${previousStatus} → ${newStatus}`,
      meta: { previousStatus, source: 'external_api', clientName: client.name },
    },
  })

  return successResponse({
    data: {
      taskId: updated.id,
      externalRef: updated.externalRef,
      status: updated.status,
      previousStatus,
      completedAt: updated.completedAt,
      updatedAt: updated.updatedAt,
    },
  })
}
