import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, getUserProjectIds } from '@/lib/auth'
import { WORKFLOW_RULES, getWorkflowProgress } from '@/lib/workflow-engine'
import { cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { updateProjectSchema, idParamSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'

// GET /api/projects/[id]
export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      dynamicTasks: {
        include: { assignees: { select: { role: true, userId: true, isPrimary: true } } },
        orderBy: { createdAt: 'asc' },
      },
      wbsNodes: { orderBy: { sortOrder: 'asc' } },
    },
  })

  if (!project) return errorResponse('Dự án không tồn tại', 404)

  if (!['R01', 'R10'].includes(payload.roleCode)) {
    const allowedIds = await getUserProjectIds(payload)
    if (allowedIds !== null && !allowedIds.includes(id)) {
      return errorResponse('Dự án không tồn tại', 404)
    }
  }

  const ACTIVE = ['OPEN', 'IN_PROGRESS', 'RETURNED']

  const tasks = project.dynamicTasks.map(t => {
    const rule = WORKFLOW_RULES[t.taskType]
    const primary = t.assignees?.find(a => a.isPrimary) || t.assignees?.[0]
    const status = t.status === 'OPEN' || t.status === 'RETURNED' ? 'IN_PROGRESS' : t.status
    return {
      id: t.id,
      stepCode: t.taskType,
      stepName: t.title,
      stepNameEn: rule?.nameEn || '',
      assignedRole: primary?.role || rule?.role || '',
      assignedTo: primary?.userId || null,
      status,
      deadline: t.deadline,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      completedBy: t.completedBy,
      resultData: t.resultData,
      notes: null,
      assignee: null as { id: string; fullName: string; username: string } | null,
    }
  })

  const userIds = tasks.map(t => t.assignedTo).filter(Boolean) as string[]
  if (userIds.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, fullName: true, username: true },
    })
    const userMap = new Map(users.map(u => [u.id, u]))
    for (const t of tasks) {
      if (t.assignedTo) t.assignee = userMap.get(t.assignedTo) || null
    }
  }

  const total = tasks.length
  const completed = tasks.filter(t => t.status === 'DONE').length
  const inProgress = tasks.filter(t => ACTIVE.includes(t.status)).length

  let currentPhase = 1
  const activeTask = tasks.find(t => ACTIVE.includes(t.status))
  if (activeTask) {
    const rule = WORKFLOW_RULES[activeTask.stepCode]
    if (rule) currentPhase = rule.phase
  }

  const { dynamicTasks: _dt, ...projectData } = project

  return successResponse({
    project: {
      ...projectData,
      tasks,
      contractValue: project.contractValue?.toString(),
      progress: {
        total,
        completed,
        inProgress,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        currentPhase,
      },
    },
  })
})

// PUT /api/projects/[id]
export const PUT = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  if (!['R01', 'R02'].includes(payload.roleCode)) {
    return errorResponse('Bạn không có quyền cập nhật dự án', 403)
  }

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data
  const result = await validateBody(req, updateProjectSchema)
  if (!result.success) return result.response
  const { projectName, clientName, contractValue, currency, startDate, endDate, status, description } = result.data

  const project = await prisma.project.update({
    where: { id },
    data: {
      projectName,
      clientName,
      contractValue: contractValue ? parseFloat(String(contractValue)) : undefined,
      currency,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      status,
      description,
    },
  })

  // Invalidate project caches after update
  await cacheInvalidate(CACHE_KEYS.projects)

  return successResponse({ project: { ...project, contractValue: project.contractValue?.toString() } }, 'Cập nhật dự án thành công')
})

// PATCH /api/projects/[id] — Project close (P6.4)
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data
  const body = await req.json()

  if (body.action === 'CLOSE') {
    if (payload.roleCode !== 'R01') {
      return errorResponse('Chỉ BGĐ (R01) mới được đóng dự án', 403)
    }

    // Check gate: P6.1, P6.2, P6.3 must be DONE
    const closureGate = await prisma.task.findMany({
      where: { projectId: id, taskType: { in: ['P6.1', 'P6.2', 'P6.3'] } },
    })

    const allDone = closureGate.length === 3 && closureGate.every(t => t.status === 'DONE')
    if (!allDone) {
      const pending = closureGate.filter(t => t.status !== 'DONE').map(t => t.taskType)
      return errorResponse(`Chưa hoàn thành: ${pending.join(', ')}. Cần hoàn tất P6.1 (MRB), P6.2 (Quyết toán), P6.3 (Bài học) trước khi đóng dự án.`)
    }

    // Close project
    const project = await prisma.project.update({
      where: { id },
      data: { status: 'CLOSED' },
    })

    // Complete P6.4 task
    await prisma.task.updateMany({
      where: { projectId: id, taskType: 'P6.4' },
      data: { status: 'DONE', completedAt: new Date(), completedBy: payload.userId },
    })

    // Audit log
    const { logAudit, getClientIP } = await import('@/lib/auth')
    await logAudit(payload.userId, 'CLOSE', 'Project', id, { status: 'CLOSED' }, getClientIP(req))

    // Invalidate project and dashboard caches after close
    await Promise.all([
      cacheInvalidate(CACHE_KEYS.projects),
      cacheInvalidate(CACHE_KEYS.dashboard),
    ])

    return successResponse(
      { project: { ...project, contractValue: project.contractValue?.toString() } },
      `Dự án ${project.projectCode} đã đóng thành công ✅`
    )
  }

  // P5.4: Client acceptance
  if (body.action === 'ACCEPT') {
    // Verify P5.3 (SAT) is DONE
    const satTask = await prisma.task.findFirst({
      where: { projectId: id, taskType: 'P5.3' },
    })
    if (!satTask || satTask.status !== 'DONE') {
      return errorResponse('Cần hoàn thành SAT (P5.3) trước khi KH xác nhận')
    }

    // Complete P5.4 task
    await prisma.task.updateMany({
      where: { projectId: id, taskType: 'P5.4' },
      data: {
        status: 'DONE',
        completedAt: new Date(),
        completedBy: payload.userId,
      },
    })

    // Audit log
    const { logAudit, getClientIP } = await import('@/lib/auth')
    await logAudit(payload.userId, 'ACCEPT', 'Project', id, {
      witnessName: body.witnessName,
      acceptanceDate: body.acceptanceDate || new Date().toISOString(),
      notes: body.notes,
    }, getClientIP(req))

    return successResponse({ ok: true }, `Khách hàng đã xác nhận nghiệm thu ✅`)
  }

  return errorResponse('Action không hợp lệ')
})

