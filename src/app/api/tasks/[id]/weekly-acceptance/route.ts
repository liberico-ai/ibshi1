import prisma from '@/lib/db'
import { notifyTaskActivated } from '@/lib/telegram-notifications'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import { resolveRoleToUser } from '@/lib/work-engine'

const ACCEPTANCE_ROLES = ['R01', 'R02', 'R02a', 'R03']

const MAX_VOLUME = 1_000_000

const STAGE_LABELS: Record<string, string> = {
  cutting: 'Cắt', fitup: 'Gá lắp', welding: 'Hàn',
  machining: 'GCCK', tryAssembly: 'Thử lắp ráp',
  dismantle: 'Tháo dỡ', blasting: 'Làm sạch',
  painting: 'Sơn', insulation: 'Bảo ôn', packing: 'Đóng kiện',
  delivery: 'Giao hàng', commissioning: 'Chạy thử',
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params

  try {
    const payload = await authenticateRequest(request as any)
    if (!payload) return unauthorizedResponse()
    const task = await prisma.task.findUnique({
      where: { id: params.id },
      select: { projectId: true, taskType: true, resultData: true },
    })
    if (!task) return errorResponse('Task not found', 404)
    if (!['P5.3', 'P5.4'].includes(task.taskType)) {
      return errorResponse('Invalid task type', 400)
    }

    const rd = (task.resultData as Record<string, any>) || {}
    const weekStart = rd.weekStartDate ? new Date(rd.weekStartDate) : null
    const weekEnd = rd.weekEndDate ? new Date(rd.weekEndDate) : null

    if (!weekStart || !weekEnd) {
      return errorResponse('Thiếu thông tin tuần (weekStartDate/weekEndDate)', 400)
    }

    // 1. Get all DailyProductionLog entries within the week range
    const dailyLogs = await (prisma as any).dailyProductionLog.findMany({
      where: {
        projectId: task.projectId,
        reportDate: { gte: weekStart, lte: weekEnd },
      },
      orderBy: { reportDate: 'asc' },
    })

    // 2. Get WBS items from P1.2A for label mapping
    const p12Task = await prisma.task.findFirst({
      where: { projectId: task.projectId, taskType: 'P1.2A' },
      select: { resultData: true },
      orderBy: { createdAt: 'desc' },
    })
    let wbsList: any[] = []
    if (p12Task?.resultData) {
      const planData = p12Task.resultData as Record<string, any>
      try { wbsList = typeof planData.wbsItems === 'string' ? JSON.parse(planData.wbsItems) : (planData.wbsItems || []) } catch { wbsList = [] }
    }

    // 3. Get P3.3/P3.4 cellAssignments for total volume reference
    const p3Tasks = await prisma.task.findMany({
      where: {
        projectId: task.projectId,
        taskType: { in: ['P3.3', 'P3.4'] },
      },
      select: { resultData: true, taskType: true },
    })

    // 3. Aggregate Total LSX from P3 tasks, and maintain teamName map
    const totalVolumeMap = new Map<string, number>()
    const teamNameMap = new Map<string, string>()
    const phamViMap = new Map<string, string>()

    for (const t of p3Tasks) {
      const pData = (t.resultData as Record<string, any>) || {}
      let cells: Record<string, Record<string, any[]>> = {}
      try {
        cells = typeof pData.cellAssignments === 'string'
          ? JSON.parse(pData.cellAssignments)
          : (pData.cellAssignments || {})
      } catch { cells = {} }
      let issued: Record<string, Record<string, Record<string, boolean>>> = {}
      try {
        issued = typeof pData.lsxIssuedDetails === 'string'
          ? JSON.parse(pData.lsxIssuedDetails)
          : (pData.lsxIssuedDetails || {})
      } catch { issued = {} }

      for (const rowKey of Object.keys(cells)) {
        const rowIdx = isNaN(parseInt(rowKey)) ? parseInt(rowKey.replace(/\D/g, '')) : parseInt(rowKey)
        let phamVi = String(wbsList[rowIdx]?.phamVi || '').trim()
        if (!phamVi && String(wbsList[rowIdx]?.thauPhu || '').trim()) phamVi = 'TP'

        for (const stageKey of Object.keys(cells[rowKey])) {
          const assignments = cells[rowKey][stageKey]
          if (!Array.isArray(assignments)) continue

          for (let ti = 0; ti < assignments.length; ti++) {
            if (issued[rowKey]?.[stageKey]?.[String(ti)]) {
              const totalVol = parseFloat(assignments[ti].volume) || 0
              if (totalVol > 0) {
                const lsxCode = `${rowKey}_${stageKey}_${ti}`
                const teamName = assignments[ti].teamName || `Tổ ${ti + 1}`
                totalVolumeMap.set(lsxCode, (totalVolumeMap.get(lsxCode) || 0) + totalVol)
                teamNameMap.set(lsxCode, teamName)
                phamViMap.set(lsxCode, phamVi)
              }
            }
          }
        }
      }
    }

    // 4. Get all previous WeeklyAcceptanceLog for cumulative calculation
    const allAcceptanceLogs = await (prisma as any).weeklyAcceptanceLog.findMany({
      where: { projectId: task.projectId },
    })

    // 5. Group daily logs by lsxCode, then by day of week
    const matrixMap = new Map<string, {
      lsxCode: string
      wbsItem: string
      stageKey: string
      stageLabel: string
      teamName: string
      phamVi: string
      unit: string
      totalLsx: number
      dailyVolumes: Record<string, number>
      weekTotal: number
      cumulativeAccepted: number
      qcAcceptedVolume?: number
      qcNotes?: string
    }>()

    const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri']

    for (const log of dailyLogs) {
      const lsxCode = log.lsxCode
      const reportDate = log.reportDate instanceof Date ? log.reportDate : new Date(log.reportDate)
      const dayOfWeek = reportDate.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) continue
      const dayKey = dayKeys[dayOfWeek - 1]

      if (!matrixMap.has(lsxCode)) {
        const parts = lsxCode.split('_')
        const rowIdx = Number(parts[0]) || 0
        const stageKey = parts.slice(1, -1).join('_') || parts[1]
        const wbsName = wbsList[rowIdx]?.hangMuc || `Hạng mục #${rowIdx + 1}`
        const phamVi = phamViMap.get(lsxCode) || wbsList[rowIdx]?.phamVi || ''
        const unit = wbsList[rowIdx]?.dvt || 'kg'
        const teamName = teamNameMap.get(lsxCode) || `Tổ (Chưa rõ)`

        const prevLogs = allAcceptanceLogs.filter((a: any) => a.lsxCode === lsxCode && (a.year < rd.year || (a.year === rd.year && a.weekNumber < rd.weekNumber)))
        const prevPMLogs = prevLogs.filter((a: any) => a.role === 'PM')
        const cumulativeAccepted = prevPMLogs.reduce((sum: number, a: any) => sum + Number(a.acceptedVolume || 0), 0)

        let qcAcceptedVolume: number | undefined
        let qcNotes: string | undefined
        if (task.taskType === 'P5.4') {
          const qcLog = allAcceptanceLogs.find((a: any) => a.lsxCode === lsxCode && a.year === (rd.year || new Date().getFullYear()) && a.weekNumber === rd.weekNumber && a.role === 'QC')
          if (qcLog) {
            qcAcceptedVolume = Number(qcLog.acceptedVolume || 0)
            qcNotes = qcLog.notes || undefined
          } else {
            qcAcceptedVolume = 0
          }
        }

        matrixMap.set(lsxCode, {
          lsxCode,
          wbsItem: wbsName + (phamVi ? ` (${phamVi})` : ''),
          stageKey,
          stageLabel: STAGE_LABELS[stageKey] || stageKey,
          teamName,
          phamVi,
          unit,
          totalLsx: totalVolumeMap.get(lsxCode) || 0,
          dailyVolumes: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 },
          weekTotal: 0,
          cumulativeAccepted,
          qcAcceptedVolume,
          qcNotes,
        })
      }

      const entry = matrixMap.get(lsxCode)!
      const vol = Number(log.reportedVolume || 0)
      entry.dailyVolumes[dayKey] = (entry.dailyVolumes[dayKey] || 0) + vol
      entry.weekTotal += vol
    }

    const items = Array.from(matrixMap.values())

    return successResponse({
      weekNumber: rd.weekNumber,
      year: rd.year,
      weekStartDate: rd.weekStartDate,
      weekEndDate: rd.weekEndDate,
      items,
    })
  } catch (err: any) {
    console.error('Weekly Acceptance GET error:', err)
    return errorResponse(err.message || 'Internal Server Error', 500)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params

  try {
    const payload = await authenticateRequest(request as any)
    if (!payload) return unauthorizedResponse()
    if (!requireRoles(payload.roleCode, ACCEPTANCE_ROLES)) {
      return errorResponse('Không có quyền nghiệm thu', 403)
    }

    const task = await prisma.task.findUnique({
      where: { id: params.id },
      select: {
        id: true, projectId: true, taskType: true, status: true, resultData: true,
        project: { select: { projectCode: true, projectName: true } },
      },
    })
    if (!task) return errorResponse('Task not found', 404)
    if (!['P5.3', 'P5.4'].includes(task.taskType)) {
      return errorResponse('Invalid task type', 400)
    }
    if (task.status === 'DONE') {
      return errorResponse('Task đã hoàn thành', 400)
    }

    const body = await request.json()
    const { acceptanceData, notes } = body as {
      acceptanceData: { lsxCode: string; reportedTotal: number; acceptedVolume: number; notes?: string }[]
      notes?: string
    }
    const userId = payload.userId

    if (!acceptanceData || !Array.isArray(acceptanceData)) {
      return errorResponse('Missing acceptanceData', 400)
    }

    for (const item of acceptanceData) {
      if (item.acceptedVolume != null && item.acceptedVolume > MAX_VOLUME) {
        return errorResponse(`Khối lượng vượt giới hạn cho phép (${MAX_VOLUME})`, 400)
      }
    }

    const rd = (task.resultData as Record<string, any>) || {}
    const weekNumber = rd.weekNumber || 0
    const year = rd.year || new Date().getFullYear()
    const weekStartDate = rd.weekStartDate ? new Date(rd.weekStartDate) : new Date()
    const weekEndDate = rd.weekEndDate ? new Date(rd.weekEndDate) : new Date()
    const role = task.taskType === 'P5.3' ? 'QC' : 'PM'

    const savedLogs = await (prisma as any).$transaction(
      acceptanceData
        .filter(item => item.acceptedVolume != null)
        .map(item =>
          (prisma as any).weeklyAcceptanceLog.create({
            data: {
              projectId: task.projectId,
              lsxCode: item.lsxCode,
              weekNumber,
              year,
              weekStartDate,
              weekEndDate,
              taskId: task.id,
              role,
              reportedTotal: item.reportedTotal || 0,
              acceptedVolume: item.acceptedVolume,
              inspectorId: userId,
              notes: item.notes || null,
            },
          })
        )
    )

    // ══════════════════════════════════════════════════════════════
    //  AUTO-TRIGGER P5.1.1: Check if any WBS item reached 100%
    // ══════════════════════════════════════════════════════════════
    try {
      const allLogs = await (prisma as any).weeklyAcceptanceLog.findMany({
        where: { projectId: task.projectId, role },
      })

      const p3Tasks = await prisma.task.findMany({
        where: { projectId: task.projectId, taskType: { in: ['P3.3', 'P3.4'] } },
        select: { resultData: true },
      })

      const totalVolumeMap = new Map<string, number>()
      const lsxToWbsRow = new Map<string, number>()

      for (const t of p3Tasks) {
        const pData = (t.resultData as Record<string, any>) || {}
        let cells: Record<string, Record<string, any[]>> = {}
        try { cells = typeof pData.cellAssignments === 'string' ? JSON.parse(pData.cellAssignments) : (pData.cellAssignments || {}) } catch { cells = {} }
        let issued: Record<string, Record<string, Record<string, boolean>>> = {}
        try { issued = typeof pData.lsxIssuedDetails === 'string' ? JSON.parse(pData.lsxIssuedDetails) : (pData.lsxIssuedDetails || {}) } catch { issued = {} }

        for (const rowKey of Object.keys(cells)) {
          for (const stageKey of Object.keys(cells[rowKey])) {
            const assignments = cells[rowKey][stageKey]
            if (!Array.isArray(assignments)) continue
            for (let ti = 0; ti < assignments.length; ti++) {
              if (issued[rowKey]?.[stageKey]?.[String(ti)]) {
                const totalVol = parseFloat(assignments[ti].volume) || 0
                if (totalVol > 0) {
                  const lsxCode = `${rowKey}_${stageKey}_${ti}`
                  totalVolumeMap.set(lsxCode, (totalVolumeMap.get(lsxCode) || 0) + totalVol)
                  lsxToWbsRow.set(lsxCode, Number(rowKey))
                }
              }
            }
          }
        }
      }

      const wbsRows = new Map<number, { stages: string[]; allComplete: boolean }>()
      for (const [lsxCode, totalVol] of totalVolumeMap) {
        const rowIdx = lsxToWbsRow.get(lsxCode)!
        if (!wbsRows.has(rowIdx)) wbsRows.set(rowIdx, { stages: [], allComplete: true })
        const entry = wbsRows.get(rowIdx)!
        entry.stages.push(lsxCode)

        const cumAccepted = allLogs
          .filter((a: any) => a.lsxCode === lsxCode)
          .reduce((sum: number, a: any) => sum + Number(a.acceptedVolume || 0), 0)

        if (cumAccepted < totalVol) {
          entry.allComplete = false
        }
      }

      // Check existing P5.1.1 tasks to avoid duplicates
      const existingP511 = await prisma.task.findMany({
        where: { projectId: task.projectId, taskType: 'P5.1.1' },
        select: { resultData: true },
      })
      const existingWbsRows = new Set<number>()
      for (const t511 of existingP511) {
        const rd511 = t511.resultData as Record<string, any> | null
        if (rd511?.wbsRowIndex != null) existingWbsRows.add(Number(rd511.wbsRowIndex))
      }

      const p12aTask = await prisma.task.findFirst({
        where: { projectId: task.projectId, taskType: 'P1.2A' },
        select: { resultData: true },
      })
      let wbsList: any[] = []
      if (p12aTask?.resultData) {
        const planData = p12aTask.resultData as Record<string, any>
        try { wbsList = typeof planData.wbsItems === 'string' ? JSON.parse(planData.wbsItems) : (planData.wbsItems || []) } catch { wbsList = [] }
      }

      for (const [rowIdx, wbsInfo] of wbsRows) {
        if (!wbsInfo.allComplete) continue
        if (existingWbsRows.has(rowIdx)) continue

        const wbsName = wbsList[rowIdx]?.hangMuc || `Hạng mục #${rowIdx + 1}`
        const totalKL = wbsInfo.stages.reduce((sum, lsx) => sum + (totalVolumeMap.get(lsx) || 0), 0)

        const newP511 = await prisma.task.create({
          data: {
            projectId: task.projectId,
            level: 2,
            taskType: 'P5.1.1',
            title: `Yêu cầu nghiệm thu CL: ${wbsName}`,
            priority: 'NORMAL',
            createdBy: userId,
            assignedAt: new Date(),
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            resultData: {
              wbsRowIndex: rowIdx,
              hangMucName: wbsName,
              totalKL,
              projectName: task.project?.projectName || '',
              projectCode: task.project?.projectCode || '',
              stages: wbsInfo.stages,
            },
          },
        })
        const p511User = await resolveRoleToUser('R06b', task.projectId)
        await prisma.taskAssignee.create({
          data: { taskId: newP511.id, role: 'R06b', userId: p511User.id, isPrimary: true },
        })
        await prisma.taskHistory.create({
          data: { taskId: newP511.id, action: 'CREATED', byUserId: userId, toRole: 'R06b' },
        })
        console.log(`[AUTO] Created P5.1.1 for WBS "${wbsName}" (row ${rowIdx}) — 100% accepted`)

        try {
          const users = await prisma.user.findMany({ where: { roleCode: 'R06b', isActive: true }, select: { id: true, username: true, telegramChatId: true } })
          const projCode = task.project?.projectCode || ''
          const projName = task.project?.projectName || ''

          if (users.length > 0) {
            await prisma.notification.createMany({
              data: users.map(u => ({
                userId: u.id, title: `Yêu cầu nghiệm thu mới: ${projCode}`,
                message: `Đã tự động tạo Yêu cầu nghiệm thu cho hạng mục: ${wbsName}.`,
                type: 'task_assigned', linkUrl: `/dashboard/work/${newP511.id}`,
              }))
            })
            await notifyTaskActivated({
              stepCode: 'P5.1.1', stepName: newP511.title,
              projectCode: projCode, projectName: projName,
              assignedRole: 'R06b', deadline: null, taskId: newP511.id,
              mentionUsers: users.map(u => ({ fullName: u.username, telegramChatId: u.telegramChatId }))
            }).catch(console.error)
          }
        } catch (e) { console.error('[AUTO] P5.1.1 notification error:', e) }
      }
    } catch (err) {
      console.error('[AUTO] P5.1.1 check error:', err)
    }

    // ══════════════════════════════════════════════════════════════
    //  AUTO-OPEN P5.5: when both QC and PM cumulative acceptance
    //  reach the planned total
    // ══════════════════════════════════════════════════════════════
    try {
      const [qcLogs, pmLogs] = await Promise.all([
        (prisma as any).weeklyAcceptanceLog.findMany({
          where: { projectId: task.projectId, role: 'QC' },
          select: { acceptedVolume: true },
        }),
        (prisma as any).weeklyAcceptanceLog.findMany({
          where: { projectId: task.projectId, role: 'PM' },
          select: { acceptedVolume: true },
        }),
      ])

      const p3TasksForP55 = await prisma.task.findMany({
        where: { projectId: task.projectId, taskType: { in: ['P3.3', 'P3.4'] } },
        select: { resultData: true },
      })
      let plannedTotal = 0
      for (const t of p3TasksForP55) {
        const pData = (t.resultData as Record<string, any>) || {}
        let cells: Record<string, Record<string, any[]>> = {}
        try { cells = typeof pData.cellAssignments === 'string' ? JSON.parse(pData.cellAssignments) : (pData.cellAssignments || {}) } catch { cells = {} }
        let issued: Record<string, Record<string, Record<string, boolean>>> = {}
        try { issued = typeof pData.lsxIssuedDetails === 'string' ? JSON.parse(pData.lsxIssuedDetails) : (pData.lsxIssuedDetails || {}) } catch { issued = {} }
        for (const rowKey of Object.keys(cells)) {
          for (const stageKey of Object.keys(cells[rowKey])) {
            const assignments = cells[rowKey][stageKey]
            if (!Array.isArray(assignments)) continue
            for (let ti = 0; ti < assignments.length; ti++) {
              if (issued[rowKey]?.[stageKey]?.[String(ti)]) {
                plannedTotal += parseFloat(assignments[ti].volume) || 0
              }
            }
          }
        }
      }

      const qcTotal = qcLogs.reduce((s: number, l: any) => s + Number(l.acceptedVolume || 0), 0)
      const pmTotal = pmLogs.reduce((s: number, l: any) => s + Number(l.acceptedVolume || 0), 0)
      const threshold = plannedTotal * 0.995
      const reached = plannedTotal > 0 && qcTotal >= threshold && pmTotal >= threshold

      if (reached) {
        const activated = await prisma.task.updateMany({
          where: { projectId: task.projectId, taskType: 'P5.5', status: 'PENDING' },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            deadline: WORKFLOW_RULES['P5.5'].deadlineDays
              ? new Date(Date.now() + WORKFLOW_RULES['P5.5'].deadlineDays * 24 * 60 * 60 * 1000)
              : null,
          },
        })
        if (activated.count > 0) {
          console.log(`[AUTO] P5.5 activated — QC ${qcTotal.toFixed(2)} & PM ${pmTotal.toFixed(2)} ≥ planned ${plannedTotal.toFixed(2)}`)
          try {
            const users = await prisma.user.findMany({ where: { roleCode: 'R03', isActive: true }, select: { id: true, username: true, telegramChatId: true } })
            const projCode = task.project?.projectCode || ''
            const projName = task.project?.projectName || ''
            const p55 = await prisma.task.findFirst({ where: { projectId: task.projectId, taskType: 'P5.5' }, select: { id: true, title: true } })
            if (users.length > 0 && p55) {
              await prisma.notification.createMany({
                data: users.map(u => ({
                  userId: u.id,
                  title: `P5.5 — Tính lương khoán: ${projCode}`,
                  message: `Dự án đã nghiệm thu đủ 100% khối lượng. Bạn có thể bắt đầu tổng hợp và tính lương khoán.`,
                  type: 'task_assigned',
                  linkUrl: `/dashboard/work/${p55.id}`,
                })),
              })
              await notifyTaskActivated({
                stepCode: 'P5.5', stepName: p55.title,
                projectCode: projCode, projectName: projName,
                assignedRole: 'R03', deadline: null, taskId: p55.id,
                mentionUsers: users.map(u => ({ fullName: u.username, telegramChatId: u.telegramChatId })),
              }).catch(console.error)
            }
          } catch (e) { console.error('[AUTO] P5.5 notification error:', e) }
        }
      }
    } catch (err) {
      console.error('[AUTO] P5.5 check error:', err)
    }

    // Mark task as DONE and trigger workflow engine hooks
    const { completeTask } = await import('@/lib/workflow-engine')

    const finalResultData = {
      ...rd,
      _acceptanceSubmitted: true,
      _acceptanceCount: savedLogs.length,
      _role: role,
      submittedAt: new Date().toISOString(),
    }
    const finalNotes = notes || `${role} nghiệm thu tuần W${weekNumber} — ${savedLogs.length} hạng mục`

    await completeTask(task.id, userId, finalResultData, finalNotes)

    return successResponse({
      message: `Đã lưu ${savedLogs.length} bản ghi nghiệm thu (${role}). Dữ liệu được bảo vệ vĩnh viễn.`,
      savedCount: savedLogs.length,
    })
  } catch (err: any) {
    if (err.code === 'P2002') {
      return errorResponse('Phiếu nghiệm thu tuần này đã được gửi trước đó. Dữ liệu không thể sửa đổi.', 409)
    }
    console.error('Weekly Acceptance POST error:', err)
    return errorResponse('Lỗi máy chủ nội bộ', 500)
  }
}