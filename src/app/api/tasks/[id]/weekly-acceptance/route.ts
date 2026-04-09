import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

/**
 * GET /api/tasks/[id]/weekly-acceptance
 *
 * Loads the "Siêu Bảng" matrix for P5.3 / P5.4 weekly acceptance tasks.
 * Queries DailyProductionLog within the week range stored in task.resultData,
 * grouped by LSX code → showing daily columns (T2→T6) + weekly total.
 *
 * POST /api/tasks/[id]/weekly-acceptance
 *
 * "BẢO VỆ DỮ LIỆU BẤT KHẢ XÂM PHẠM"
 * Saves the PM/QC acceptance values as immutable WeeklyAcceptanceLog records.
 * These records CANNOT be modified or deleted — they serve as the official
 * financial audit trail for piece-rate salary and project cost reconciliation.
 */

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
    const task = await prisma.workflowTask.findUnique({
      where: { id: params.id },
      select: { projectId: true, stepCode: true, resultData: true },
    })
    if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (!['P5.3', 'P5.4'].includes(task.stepCode)) {
      return NextResponse.json({ success: false, error: 'Invalid task type' }, { status: 400 })
    }

    const rd = (task.resultData as Record<string, any>) || {}
    const weekStart = rd.weekStartDate ? new Date(rd.weekStartDate) : null
    const weekEnd = rd.weekEndDate ? new Date(rd.weekEndDate) : null

    if (!weekStart || !weekEnd) {
      return NextResponse.json({ success: false, error: 'Thiếu thông tin tuần (weekStartDate/weekEndDate)' }, { status: 400 })
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
    const p12Task = await prisma.workflowTask.findFirst({
      where: { projectId: task.projectId, stepCode: 'P1.2A' },
      select: { resultData: true },
      orderBy: { createdAt: 'desc' },
    })
    let wbsList: any[] = []
    if (p12Task?.resultData) {
      const planData = p12Task.resultData as Record<string, any>
      try { wbsList = typeof planData.wbsItems === 'string' ? JSON.parse(planData.wbsItems) : (planData.wbsItems || []) } catch { wbsList = [] }
    }

    // 3. Get P3.3/P3.4 cellAssignments for total volume reference
    const p3Tasks = await prisma.workflowTask.findMany({
      where: {
        projectId: task.projectId,
        stepCode: { in: ['P3.3', 'P3.4'] },
      },
      select: { resultData: true, stepCode: true },
    })

    // Build totalVolume map from cellAssignments
    const totalVolumeMap = new Map<string, number>()
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
        for (const stageKey of Object.keys(cells[rowKey])) {
          const assignments = cells[rowKey][stageKey]
          if (!Array.isArray(assignments)) continue
          let totalVol = 0
          for (let ti = 0; ti < assignments.length; ti++) {
            if (issued[rowKey]?.[stageKey]?.[String(ti)]) {
              totalVol += parseFloat(assignments[ti].volume) || 0
            }
          }
          if (totalVol > 0) {
            const lsxCode = `${rowKey}_${stageKey}`
            totalVolumeMap.set(lsxCode, (totalVolumeMap.get(lsxCode) || 0) + totalVol)
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
      unit: string
      totalLsx: number
      dailyVolumes: Record<string, number>
      weekTotal: number
      cumulativeAccepted: number // sum of previous weeks
      qcAcceptedVolume?: number // QC's value for THIS week (if P5.4)
      qcNotes?: string
    }>()

    const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri']

    for (const log of dailyLogs) {
      const lsxCode = log.lsxCode
      const reportDate = log.reportDate instanceof Date ? log.reportDate : new Date(log.reportDate)
      const dayOfWeek = reportDate.getDay() // 1=Mon through 5=Fri
      const dayKey = dayKeys[dayOfWeek - 1] || 'mon'

      if (!matrixMap.has(lsxCode)) {
        // Parse lsxCode: "rowIdx_stageKey"
        const parts = lsxCode.split('_')
        const rowIdx = Number(parts[0]) || 0
        const stageKey = parts.slice(1).join('_')
        const wbsName = wbsList[rowIdx]?.hangMuc || `Hạng mục #${rowIdx + 1}`
        const phamVi = wbsList[rowIdx]?.phamVi || ''
        const unit = wbsList[rowIdx]?.dvt || 'kg'

        // Cumulative accepted from previous weeks (before this week)
        const prevLogs = allAcceptanceLogs.filter((a: any) => a.lsxCode === lsxCode && (a.year < rd.year || (a.year === rd.year && a.weekNumber < rd.weekNumber)))
        // For P5.4, PM's cumulative from previous weeks. But since PM and QC have records, be careful not to double count!
        // We should just sum where role = 'PM' for previous weeks.
        const prevPMLogs = prevLogs.filter((a: any) => a.role === 'PM')
        const cumulativeAccepted = prevPMLogs.reduce((sum: number, a: any) => sum + Number(a.acceptedVolume || 0), 0)

        // For P5.4, find QC's acceptance for THIS week
        let qcAcceptedVolume: number | undefined
        let qcNotes: string | undefined
        if (task.stepCode === 'P5.4') {
          const qcLog = allAcceptanceLogs.find((a: any) => a.lsxCode === lsxCode && a.year === (rd.year || new Date().getFullYear()) && a.weekNumber === rd.weekNumber && a.role === 'QC')
          if (qcLog) {
            qcAcceptedVolume = Number(qcLog.acceptedVolume || 0)
            qcNotes = qcLog.notes || undefined
          } else {
            qcAcceptedVolume = 0 // If QC didn't accept anything, fallback to 0
          }
        }

        matrixMap.set(lsxCode, {
          lsxCode,
          wbsItem: wbsName + (phamVi ? ` (${phamVi})` : ''),
          stageKey,
          stageLabel: STAGE_LABELS[stageKey] || stageKey,
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

    return NextResponse.json({
      success: true,
      weekNumber: rd.weekNumber,
      year: rd.year,
      weekStartDate: rd.weekStartDate,
      weekEndDate: rd.weekEndDate,
      items,
    })
  } catch (err: any) {
    console.error('Weekly Acceptance GET error:', err)
    return NextResponse.json({ success: false, error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params

  try {
    const task = await prisma.workflowTask.findUnique({
      where: { id: params.id },
      include: { project: { select: { projectCode: true } } },
    })
    if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (!['P5.3', 'P5.4'].includes(task.stepCode)) {
      return NextResponse.json({ success: false, error: 'Invalid task type' }, { status: 400 })
    }
    if (task.status === 'DONE') {
      return NextResponse.json({ success: false, error: 'Task đã hoàn thành' }, { status: 400 })
    }

    const body = await request.json()
    const { acceptanceData, userId, notes } = body as {
      acceptanceData: { lsxCode: string; reportedTotal: number; acceptedVolume: number; notes?: string }[]
      userId: string
      notes?: string
    }

    if (!acceptanceData || !Array.isArray(acceptanceData) || !userId) {
      return NextResponse.json({ success: false, error: 'Missing acceptanceData or userId' }, { status: 400 })
    }

    const rd = (task.resultData as Record<string, any>) || {}
    const weekNumber = rd.weekNumber || 0
    const year = rd.year || new Date().getFullYear()
    const weekStartDate = rd.weekStartDate ? new Date(rd.weekStartDate) : new Date()
    const weekEndDate = rd.weekEndDate ? new Date(rd.weekEndDate) : new Date()
    const role = task.stepCode === 'P5.3' ? 'QC' : 'PM'

    // ══════════════════════════════════════════════════════════════
    //  BẢO VỆ DỮ LIỆU BẤT KHẢ XÂM PHẠM
    //  Each row is saved as an immutable WeeklyAcceptanceLog record.
    //  These records serve as the official financial audit trail.
    // ══════════════════════════════════════════════════════════════
    const savedLogs = []

    for (const item of acceptanceData) {
      if (item.acceptedVolume == null) continue

      const log = await (prisma as any).weeklyAcceptanceLog.create({
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
      savedLogs.push(log)
    }

    // Mark task as DONE and trigger workflow engine hooks (like generating P5.4)
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

    return NextResponse.json({
      success: true,
      message: `Đã lưu ${savedLogs.length} bản ghi nghiệm thu (${role}). Dữ liệu được bảo vệ vĩnh viễn.`,
      savedCount: savedLogs.length,
    })
  } catch (err: any) {
    // Handle unique constraint violation (duplicate submission)
    if (err.code === 'P2002') {
      return NextResponse.json({
        success: false,
        error: 'Phiếu nghiệm thu tuần này đã được gửi trước đó. Dữ liệu không thể sửa đổi.',
      }, { status: 409 })
    }
    console.error('Weekly Acceptance POST error:', err)
    return NextResponse.json({ success: false, error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
