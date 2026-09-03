import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, getUserProjectIds } from '@/lib/auth'
import { WORKFLOW_RULES, PHASE_LABELS, getWorkflowProgress } from '@/lib/workflow-engine'
import { ROLES } from '@/lib/constants'
import { cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { emitContractUpdated } from '@/lib/webhook'
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
      templateStepId: t.templateStepId,
      stepCode: t.taskType,
      stepName: t.title,
      stepNameEn: rule?.nameEn || '',
      assignedRole: primary?.role || rule?.role || '',
      assignedTo: primary?.userId || null,
      status,
      revisionRound: (t as { revisionRound?: number }).revisionRound ?? 0,
      revisionId: (t as { revisionId?: string | null }).revisionId ?? null,
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

  const hasTemplateTasks = project.dynamicTasks.some(t => t.templateStepId !== null)

  // ── Resolve template steps for per-phase progress ──
  let templateSteps: { code: string; title: string; roleCode: string | null; orderIndex: number }[] = []
  if (hasTemplateTasks) {
    const firstWithTemplate = project.dynamicTasks.find(t => t.templateStepId !== null)
    if (firstWithTemplate?.templateStepId) {
      const ts = await prisma.templateStep.findUnique({
        where: { id: firstWithTemplate.templateStepId },
        select: { templateId: true },
      })
      if (ts) {
        templateSteps = await prisma.templateStep.findMany({
          where: { templateId: ts.templateId },
          orderBy: { orderIndex: 'asc' },
          select: { code: true, title: true, roleCode: true, orderIndex: true },
        })
      }
    }
  }

  // If no template found, fall back to WORKFLOW_RULES keys
  const allStepCodes = templateSteps.length > 0
    ? templateSteps.map(s => s.code)
    : Object.keys(WORKFLOW_RULES)

  const templateStepMap = new Map(templateSteps.map(s => [s.code, s]))

  // ── Build per-phase breakdown ──
  const phaseMap = new Map<number, {
    phase: number
    name: string
    steps: {
      stepCode: string
      stepName: string
      status: 'DONE' | 'IN_PROGRESS' | 'RETURNED' | 'PENDING'
      assignedRole: string
      roleName: string
      assignee: { fullName: string; username: string } | null
      deadline: string | null
      completedAt: string | null
      taskId: string | null
    }[]
  }>()

  for (const stepCode of allStepCodes) {
    const rule = WORKFLOW_RULES[stepCode]
    const tplStep = templateStepMap.get(stepCode)

    // Determine phase
    let phase = rule?.phase
    if (!phase) {
      const m = stepCode.match(/^P(\d)/)
      phase = m ? parseInt(m[1], 10) : 0
    }

    const label = PHASE_LABELS[phase]
    if (!phaseMap.has(phase)) {
      phaseMap.set(phase, {
        phase,
        name: label?.name || `Phase ${phase}`,
        steps: [],
      })
    }

    // ── Task nào ĐẠI DIỆN cho một bước của quy trình ──
    //
    // Màn "Tạo việc" cố tình mượn mã bước làm nhãn loại việc (P2.1 = "Đề xuất/yêu cầu vật tư",
    // P1.1B = "Yêu cầu phê duyệt", P3.5 = "Tìm nhà cung cấp"…) để việc tạo tay thừa hưởng
    // định tuyến và biểu mẫu. Hệ quả: việc tạo tay mang cùng nhãn với bước quy trình, rồi
    // nhảy vào khung 32 bước — hiện "Xong" dù chưa ai làm bước đó, và tiêu đề tự do của nó
    // thay luôn tên bước.
    //
    // Chỉ task GẮN QUY TRÌNH (templateStepId != null) mới được đại diện bước. Dự án cũ chưa
    // có template (hasTemplateTasks = false) thì giữ nguyên cách cũ, không thì cả 32 bước
    // hoá trống.
    const allMatches = tasks.filter(t => t.stepCode === stepCode)
    const templateMatches = allMatches.filter(t => t.templateStepId)
    const matchingTasks = hasTemplateTasks ? templateMatches : allMatches

    // Determine step status
    let status: 'DONE' | 'IN_PROGRESS' | 'RETURNED' | 'PENDING' = 'PENDING'
    let bestTask: typeof tasks[number] | null = null
    if (matchingTasks.length > 0) {
      if (matchingTasks.some(t => t.status === 'DONE')) {
        status = 'DONE'
        bestTask = matchingTasks.find(t => t.status === 'DONE') || matchingTasks[0]
      } else if (matchingTasks.some(t => t.status === 'RETURNED')) {
        status = 'RETURNED'
        bestTask = matchingTasks.find(t => t.status === 'RETURNED') || matchingTasks[0]
      } else if (matchingTasks.some(t => ACTIVE.includes(t.status))) {
        status = 'IN_PROGRESS'
        bestTask = matchingTasks.find(t => ACTIVE.includes(t.status)) || matchingTasks[0]
      } else {
        status = 'IN_PROGRESS'
        bestTask = matchingTasks[0]
      }
    }

    // Resolve role
    const assignedRole = bestTask?.assignedRole || tplStep?.roleCode || rule?.role || ''
    const roleEntry = ROLES[assignedRole as keyof typeof ROLES]
    const roleName = roleEntry?.name || ''

    phaseMap.get(phase)!.steps.push({
      stepCode,
      // Tên bước LUÔN lấy từ quy trình, không lấy tiêu đề task — tiêu đề là chữ người dùng
      // tự gõ nên bước sẽ mang tên sai. Dự án cũ không có template thì đành lấy tiêu đề.
      stepName: tplStep?.title || rule?.name || bestTask?.stepName || stepCode,
      status,
      assignedRole,
      roleName,
      assignee: bestTask?.assignee ? { fullName: bestTask.assignee.fullName, username: bestTask.assignee.username } : null,
      deadline: bestTask?.deadline?.toISOString() || null,
      completedAt: bestTask?.completedAt?.toISOString() || null,
      taskId: bestTask?.id || null,
    })
  }

  // Sort phases by number and build final array
  const phases = Array.from(phaseMap.values())
    .sort((a, b) => a.phase - b.phase)
    .map(p => {
      const completedSteps = p.steps.filter(s => s.status === 'DONE').length
      return {
        ...p,
        totalSteps: p.steps.length,
        completedSteps,
        pct: p.steps.length > 0 ? Math.round((completedSteps / p.steps.length) * 100) : 0,
      }
    })

  // ── Overall progress (denominator = template steps, not spawned tasks) ──
  //
  // Đếm trên task THUỘC QUY TRÌNH thôi. Đếm cả việc tạo tay thì "hoàn thành" vượt cả tổng số
  // bước (đã gặp 37/32) vì một bước có thể kèm nhiều việc tạo tay cùng nhãn.
  const flowTasks = hasTemplateTasks ? tasks.filter(t => t.templateStepId) : tasks
  const totalStepCount = allStepCodes.length
  const completed = new Set(flowTasks.filter(t => t.status === 'DONE').map(t => t.stepCode)).size
  const inProgress = new Set(flowTasks.filter(t => ACTIVE.includes(t.status)).map(t => t.stepCode)).size

  let currentPhase = 1
  const activeTask = flowTasks.find(t => ACTIVE.includes(t.status))
  if (activeTask) {
    const rule = WORKFLOW_RULES[activeTask.stepCode]
    if (rule) currentPhase = rule.phase
  }

  // Count completed by unique step codes (not task count, for template-based denominator)
  const doneStepCodes = new Set(
    flowTasks.filter(t => t.status === 'DONE').map(t => t.stepCode)
  )
  const completedUniqueSteps = allStepCodes.filter(c => doneStepCodes.has(c)).length

  const { dynamicTasks: _dt, ...projectData } = project

  return successResponse({
    project: {
      ...projectData,
      tasks,
      hasTemplateTasks,
      // Việc tạo tay/chuyển tiếp mang nhãn mã bước nhưng KHÔNG thuộc quy trình — tách ra
      // để trang Dự án hiện thành mục riêng, thay vì lẫn vào khung 32 bước.
      adhocTasks: hasTemplateTasks
        ? tasks
            .filter(t => !t.templateStepId && WORKFLOW_RULES[t.stepCode])
            .map(t => ({
              id: t.id, taskType: t.stepCode, title: t.stepName, status: t.status,
              assignee: t.assignee ? { fullName: t.assignee.fullName } : null,
              deadline: t.deadline?.toISOString() || null,
              completedAt: t.completedAt?.toISOString() || null,
            }))
        : [],
      contractValue: project.contractValue?.toString(),
      progress: {
        total: totalStepCount,
        completed,
        inProgress,
        percentage: totalStepCount > 0 ? Math.round((completedUniqueSteps / totalStepCount) * 100) : 0,
        currentPhase,
      },
      phases,
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

  if (contractValue !== undefined) {
    emitContractUpdated(id, 'contract_value_updated').catch(() => {})
  }

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

    // Gate: no open NCR / ECO
    const [openNcrCount, openEcoCount] = await Promise.all([
      prisma.nonConformanceReport.count({
        where: { projectId: id, status: { notIn: ['CLOSED', 'CANCELLED'] } },
      }),
      prisma.engineeringChangeOrder.count({
        where: { projectId: id, status: { notIn: ['REJECTED', 'IMPLEMENTED'] } },
      }),
    ])
    if (openNcrCount > 0 || openEcoCount > 0) {
      const parts: string[] = []
      if (openNcrCount > 0) parts.push(`${openNcrCount} NCR`)
      if (openEcoCount > 0) parts.push(`${openEcoCount} ECO`)
      return errorResponse(`Không thể đóng: còn ${parts.join(' / ')} chưa đóng`, 422)
    }

    // Gate: quyết toán dự án phải được BGĐ duyệt (ProjectSettlement APPROVED)
    const approvedSettlement = await prisma.projectSettlement.findFirst({
      where: { projectId: id, status: 'APPROVED' },
    })
    if (!approvedSettlement) {
      return errorResponse('Không thể đóng: chưa quyết toán (settlement chưa APPROVED)', 422)
    }

    // Close project + complete P6.4 in single transaction
    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.update({
        where: { id },
        data: { status: 'CLOSED' },
      })
      await tx.task.updateMany({
        where: { projectId: id, taskType: 'P6.4' },
        data: { status: 'DONE', completedAt: new Date(), completedBy: payload.userId },
      })
      return p
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
      `Dự án ${project.projectCode} đã đóng thành công`
    )
  }

  // ── XÓA MỀM: đánh dấu status='DELETED' (không xóa cứng, không thêm cột) ──
  if (body.action === 'SOFT_DELETE') {
    if (!['R01', 'R02', 'R10'].includes(payload.roleCode)) {
      return errorResponse('Chỉ BGĐ (R01), PM (R02) hoặc Quản trị (R10) mới được xóa dự án', 403)
    }
    const existing = await prisma.project.findUnique({ where: { id }, select: { projectCode: true, status: true } })
    if (!existing) return errorResponse('Dự án không tồn tại', 404)
    if (existing.status === 'DELETED') return errorResponse('Dự án đã bị xóa trước đó', 422)
    await prisma.project.update({ where: { id }, data: { status: 'DELETED' } })
    const { logAudit, getClientIP } = await import('@/lib/auth')
    await logAudit(payload.userId, 'SOFT_DELETE', 'Project', id, { fromStatus: existing.status }, getClientIP(req))
    await Promise.all([cacheInvalidate(CACHE_KEYS.projects), cacheInvalidate(CACHE_KEYS.dashboard)])
    return successResponse({ ok: true }, `Đã xóa (mềm) dự án ${existing.projectCode} — có thể khôi phục`)
  }

  // ── KHÔI PHỤC dự án đã xóa mềm (status='DELETED' → 'ACTIVE') ──
  if (body.action === 'RESTORE') {
    if (!['R01', 'R02', 'R10'].includes(payload.roleCode)) {
      return errorResponse('Chỉ BGĐ (R01), PM (R02) hoặc Quản trị (R10) mới được khôi phục dự án', 403)
    }
    const existing = await prisma.project.findUnique({ where: { id }, select: { projectCode: true, status: true } })
    if (!existing) return errorResponse('Dự án không tồn tại', 404)
    if (existing.status !== 'DELETED') return errorResponse('Dự án này không ở trạng thái đã xóa', 422)
    await prisma.project.update({ where: { id }, data: { status: 'ACTIVE' } })
    const { logAudit, getClientIP } = await import('@/lib/auth')
    await logAudit(payload.userId, 'RESTORE', 'Project', id, { toStatus: 'ACTIVE' }, getClientIP(req))
    await Promise.all([cacheInvalidate(CACHE_KEYS.projects), cacheInvalidate(CACHE_KEYS.dashboard)])
    return successResponse({ ok: true }, `Đã khôi phục dự án ${existing.projectCode}`)
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

    return successResponse({ ok: true }, `Khách hàng đã xác nhận nghiệm thu`)
  }

  // ── P1.1B: BGĐ phê duyệt / từ chối TRIỂN KHAI dự án (Cách A — đóng/trả task quy trình) ──
  if (body.action === 'APPROVE_KICKOFF' || body.action === 'REJECT_KICKOFF') {
    if (payload.roleCode !== 'R01') {
      return errorResponse('Chỉ BGĐ (R01) mới được duyệt triển khai dự án', 403)
    }
    const { completeStepTaskFromSidebar, returnStepTaskFromSidebar } = await import('@/lib/work-engine')
    const { logAudit, getClientIP } = await import('@/lib/auth')

    if (body.action === 'APPROVE_KICKOFF') {
      const r = await completeStepTaskFromSidebar(id, 'P1.1B', payload.userId, { kickoffApprovedBy: payload.userId, kickoffApprovedAt: new Date().toISOString() })
      if (!r.ok) return errorResponse('Không có bước P1.1B đang chờ duyệt cho dự án này', 422)
      await logAudit(payload.userId, 'APPROVE_KICKOFF', 'Project', id, {}, getClientIP(req))
      return successResponse({ ok: true }, 'Đã duyệt triển khai dự án — quy trình chuyển tiếp')
    } else {
      const reason = (body.reason || '').toString().trim()
      if (!reason) return errorResponse('Cần nhập lý do từ chối', 422)
      const r = await returnStepTaskFromSidebar(id, 'P1.1B', payload.userId, reason)
      if (!r.ok) return errorResponse('Không có bước P1.1B đang chờ duyệt cho dự án này', 422)
      await logAudit(payload.userId, 'REJECT_KICKOFF', 'Project', id, { reason }, getClientIP(req))
      return successResponse({ ok: true }, 'Đã từ chối triển khai — trả lại kèm lý do')
    }
  }

  // ── Duyệt / Từ chối 1 BƯỚC quy trình bất kỳ trên trang dự án (Cách A) — dùng chung cho
  //    P1.3, P2.5, P3.6, P6.5… (BGĐ). body.stepCode xác định bước. ──
  if (body.action === 'APPROVE_STEP' || body.action === 'REJECT_STEP') {
    if (payload.roleCode !== 'R01') {
      return errorResponse('Chỉ BGĐ (R01) mới được duyệt bước này', 403)
    }
    const stepCode = String(body.stepCode || '').trim()
    if (!stepCode) return errorResponse('Thiếu stepCode', 400)
    const { completeStepTaskFromSidebar, returnStepTaskFromSidebar } = await import('@/lib/work-engine')
    const { logAudit, getClientIP } = await import('@/lib/auth')

    if (body.action === 'APPROVE_STEP') {
      const r = await completeStepTaskFromSidebar(id, stepCode, payload.userId, { approvedBy: payload.userId, approvedAt: new Date().toISOString() })
      if (!r.ok) return errorResponse(r.reason && r.reason !== 'no_task' ? r.reason : `Không có bước ${stepCode} đang chờ duyệt cho dự án này`, 422)
      await logAudit(payload.userId, 'APPROVE_STEP', 'Project', id, { stepCode }, getClientIP(req))
      return successResponse({ ok: true }, 'Đã duyệt — quy trình chuyển tiếp')
    } else {
      const reason = (body.reason || '').toString().trim()
      if (!reason) return errorResponse('Cần nhập lý do từ chối', 422)
      const r = await returnStepTaskFromSidebar(id, stepCode, payload.userId, reason)
      if (!r.ok) return errorResponse(`Không có bước ${stepCode} đang chờ duyệt cho dự án này`, 422)
      await logAudit(payload.userId, 'REJECT_STEP', 'Project', id, { stepCode, reason }, getClientIP(req))
      return successResponse({ ok: true }, 'Đã từ chối — trả lại kèm lý do')
    }
  }

  return errorResponse('Action không hợp lệ')
})

