import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { WORKFLOW_RULES, getWorkflowProgress } from '@/lib/workflow-engine'
import { cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { updateProjectSchema, idParamSchema } from '@/lib/schemas'

// GET /api/projects/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        tasks: {
          include: { assignee: { select: { id: true, fullName: true, username: true } } },
          orderBy: { stepCode: 'asc' },
        },
        wbsNodes: { orderBy: { sortOrder: 'asc' } },
      },
    })

    if (!project) return errorResponse('Dự án không tồn tại', 404)

    const progress = getWorkflowProgress(project.tasks)

    // Group tasks by phase
    const tasksByPhase: Record<number, typeof project.tasks> = {}
    for (const task of project.tasks) {
      const rule = WORKFLOW_RULES[task.stepCode]
      const phase = rule?.phase ?? 0
      if (!tasksByPhase[phase]) tasksByPhase[phase] = []
      tasksByPhase[phase].push(task)
    }

    return successResponse({
      project: {
        ...project,
        contractValue: project.contractValue?.toString(),
        progress,
        tasksByPhase,
      },
    })
  } catch (err) {
    console.error('GET /api/projects/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/projects/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
  } catch (err) {
    console.error('PUT /api/projects/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PATCH /api/projects/[id] — Project close (P6.4)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
      const closureGate = await prisma.workflowTask.findMany({
        where: { projectId: id, stepCode: { in: ['P6.1', 'P6.2', 'P6.3'] } },
      })

      const allDone = closureGate.length === 3 && closureGate.every(t => t.status === 'DONE')
      if (!allDone) {
        const pending = closureGate.filter(t => t.status !== 'DONE').map(t => t.stepCode)
        return errorResponse(`Chưa hoàn thành: ${pending.join(', ')}. Cần hoàn tất P6.1 (MRB), P6.2 (Quyết toán), P6.3 (Bài học) trước khi đóng dự án.`)
      }

      // Close project
      const project = await prisma.project.update({
        where: { id },
        data: { status: 'CLOSED' },
      })

      // Complete P6.4 task
      await prisma.workflowTask.updateMany({
        where: { projectId: id, stepCode: 'P6.4' },
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
      const satTask = await prisma.workflowTask.findFirst({
        where: { projectId: id, stepCode: 'P5.3' },
      })
      if (!satTask || satTask.status !== 'DONE') {
        return errorResponse('Cần hoàn thành SAT (P5.3) trước khi KH xác nhận')
      }

      // Complete P5.4 task
      await prisma.workflowTask.updateMany({
        where: { projectId: id, stepCode: 'P5.4' },
        data: {
          status: 'DONE',
          completedAt: new Date(),
          completedBy: payload.userId,
          notes: `KH xác nhận: ${body.witnessName || '—'} — ${body.notes || ''}`,
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
  } catch (err) {
    console.error('PATCH /api/projects/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

