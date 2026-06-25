import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { rejectTask } from '@/lib/workflow-engine'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { rejectTaskSchema, idParamSchema } from '@/lib/schemas'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await authenticateRequest(request)
    if (!payload) {
      return unauthorizedResponse()
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id: taskId } = pResult.data

    const bodyResult = await validateBody(request, rejectTaskSchema)
    if (!bodyResult.success) return bodyResult.response
    const { reason, overrideRejectTo, failedContext } = bodyResult.data

    // Verify task exists and is in-progress
    const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true } })
    if (!task) {
      return errorResponse('Task not found', 404)
    }

    if (task.status !== 'IN_PROGRESS') {
      return errorResponse(`Task is ${task.status}, can only reject IN_PROGRESS tasks`)
    }

    // Role-based authorization: only the assigned role (or admin) can reject
    const taskRole = task.assignees?.[0]?.role || ''
    if (payload.roleCode !== taskRole && payload.roleCode !== 'R00') {
      return errorResponse(`Bạn (${payload.roleCode}) không có quyền từ chối bước này. Chỉ ${taskRole} mới được phép.`, 403)
    }

    const rule = WORKFLOW_RULES[task.taskType]
    if (!rule?.rejectTo && !overrideRejectTo) {
      return errorResponse(`Step ${task.taskType} has no reject destination defined`)
    }

    // Use userId from JWT token, not from body
    const result = await rejectTask(taskId, payload.userId, reason, overrideRejectTo, failedContext)

    // Invalidate dashboard and task caches after rejection
    await Promise.all([
      cacheInvalidate(CACHE_KEYS.dashboard),
      cacheInvalidate(CACHE_KEYS.tasks),
    ])

    const targetRule = WORKFLOW_RULES[result.returnedTo]
    return successResponse({
      returnedTo: result.returnedTo,
      returnedToName: targetRule?.name || result.returnedTo,
      message: `Đã từ chối. Quay về bước ${result.returnedTo}: ${targetRule?.name || ''}`,
    })
  } catch (error) {
    console.error('Reject task error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return errorResponse(message, 500)
  }
}
