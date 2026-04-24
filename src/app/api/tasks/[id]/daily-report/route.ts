import { NextResponse } from 'next/server'
import { authenticateRequest, unauthorizedResponse } from '@/lib/auth'
import prisma from '@/lib/db'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const payload = await authenticateRequest(request as any)
  if (!payload) return unauthorizedResponse()

  try {
    const task = await prisma.workflowTask.findUnique({
      where: { id: params.id },
      select: { projectId: true, stepCode: true }
    })

    if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (task.stepCode !== 'P5.1' && task.stepCode !== 'P5.1A') return NextResponse.json({ success: false, error: 'Invalid task type' }, { status: 400 })

    // 1. Tìm TẤT CẢ các task P3.3/P3.4 của dự án (bất kể status)
    const p3Tasks = await prisma.workflowTask.findMany({
      where: {
        projectId: task.projectId,
        stepCode: { in: ['P3.3', 'P3.4'] },
      },
      select: { resultData: true, stepCode: true }
    })

    // 2. Lấy wbsItems từ P1.2A
    const p12Task = await prisma.workflowTask.findFirst({
      where: { projectId: task.projectId, stepCode: 'P1.2A' },
      select: { resultData: true },
      orderBy: { createdAt: 'desc' }
    })

    let wbsList: any[] = []
    if (p12Task?.resultData) {
      const planData = p12Task.resultData as Record<string, any>
      try { wbsList = typeof planData.wbsItems === 'string' ? JSON.parse(planData.wbsItems) : (planData.wbsItems || []) } catch { wbsList = [] }
    }

    // 3. Lấy project info
    const project = await prisma.project.findUnique({
      where: { id: task.projectId },
      select: { projectCode: true, projectName: true }
    })

    const STAGE_LABELS: Record<string, string> = {
      cutting: 'Cắt', fitup: 'Gá lắp', welding: 'Hàn',
      machining: 'GCCK', tryAssembly: 'Thử lắp ráp',
      dismantle: 'Tháo dỡ', blasting: 'Làm sạch',
      painting: 'Sơn', insulation: 'Bảo ôn', packing: 'Đóng kiện',
      delivery: 'Giao hàng', commissioning: 'Chạy thử',
    }

    // Kiểm tra xem Kho đã xuất vật tư (P4.5 DONE) cho dự án này chưa
    const p45DoneCount = await prisma.workflowTask.count({
      where: {
        projectId: task.projectId,
        stepCode: 'P4.5',
        status: 'DONE'
      }
    })
    const warehouseHasIssued = p45DoneCount > 0

    const uniqueLsxItemsMap = new Map()

    for (const t of p3Tasks) {
      const pData = (t.resultData as Record<string, any>) || {}

      // Parse cellAssignments
      let cells: Record<string, Record<string, any[]>> = {}
      try {
        cells = typeof pData.cellAssignments === 'string'
          ? JSON.parse(pData.cellAssignments)
          : (pData.cellAssignments || {})
      } catch { cells = {} }

      // Parse lsxIssuedDetails
      let issued: Record<string, Record<string, Record<string, boolean>>> = {}
      try {
        issued = typeof pData.lsxIssuedDetails === 'string'
          ? JSON.parse(pData.lsxIssuedDetails)
          : (pData.lsxIssuedDetails || {})
      } catch { issued = {} }

      // Duyệt từng hạng mục → từng công đoạn → từng tổ đội ĐÃ PHÁT HÀNH
      for (const rowKey of Object.keys(cells)) {
        const rowIdx = isNaN(parseInt(rowKey)) ? parseInt(rowKey.replace(/\D/g, '')) : parseInt(rowKey)
        const wbsName = wbsList[rowIdx]?.hangMuc || `Hạng mục ${rowKey}`
        let phamVi = String(wbsList[rowIdx]?.phamVi || '').trim()
        const thauPhu = String(wbsList[rowIdx]?.thauPhu || '').trim()
        if (!phamVi && thauPhu) phamVi = 'TP'
        for (const stageKey of Object.keys(cells[rowKey])) {
          const assignments = cells[rowKey][stageKey]
          if (!Array.isArray(assignments)) continue

          // Filter theo giá trị ô WBS của từng công đoạn: IBS → P5.1, TP/khác → P5.1A
          const cellValue = (wbsList[rowIdx]?.[stageKey] || '').toString().toUpperCase().trim()
          const stageIsIBS = cellValue === 'IBS' || cellValue.includes('IBS')
          if (task.stepCode === 'P5.1' && !stageIsIBS) continue
          if ((task.stepCode as string) === 'P5.1A' && stageIsIBS) continue

          // Chỉ hiển thị LSX khi Kho đã hoàn thành xuất vật tư (P4.5 DONE)
          if (!warehouseHasIssued) continue

          for (let ti = 0; ti < assignments.length; ti++) {
            // Chỉ tính tổ đã được phát hành
            if (issued[rowKey]?.[stageKey]?.[String(ti)]) {
              const totalVol = parseFloat(assignments[ti].volume) || 0
              if (totalVol <= 0) continue

              const lsxCode = `${rowKey}_${stageKey}_${ti}`
              const teamName = assignments[ti].teamName || `Tổ ${ti + 1}`

              if (!uniqueLsxItemsMap.has(lsxCode)) {
                uniqueLsxItemsMap.set(lsxCode, {
                  lsxCode,
                  projectName: project?.projectName || '',
                  projectCode: project?.projectCode || '',
                  wbsItem: wbsName,
                  stageKey,
                  stageLabel: STAGE_LABELS[stageKey] || stageKey,
                  teamName, // Add teamName
                  phamVi,   // Add phamVi explicitly
                  totalLsx: totalVol,
                  unit: wbsList[rowIdx]?.dvt || 'kg',
                })
              } else {
                const existing = uniqueLsxItemsMap.get(lsxCode)
                existing.totalLsx += totalVol // Should not happen with _ti suffix, but safe to keep
              }
            }
          }
        }
      }
    }

    let uniqueLsxItems = Array.from(uniqueLsxItemsMap.values())

    // 4. Tính Lũy kế trước từ DailyProductionLog
    const lsxCodes = uniqueLsxItems.map(i => i.lsxCode)

    let logs: any[] = []
    let acceptanceLogs: any[] = []
    try {
      logs = await (prisma as any).dailyProductionLog.findMany({
        where: {
          projectId: task.projectId,
          lsxCode: { in: lsxCodes }
        }
      })
      acceptanceLogs = await (prisma as any).weeklyAcceptanceLog.findMany({
        where: {
          projectId: task.projectId,
          lsxCode: { in: lsxCodes },
          role: 'PM'
        }
      })
    } catch {
      // Schema may not be synced
    }

    // Parse date from query with validation
    const url = new URL(request.url)
    const dateParam = url.searchParams.get('date')
    const todayDateStr = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && !isNaN(Date.parse(dateParam)))
      ? dateParam
      : new Date().toISOString().split('T')[0]

    uniqueLsxItems = uniqueLsxItems.map(item => {
      const itemLogs = logs.filter((l: any) => l.lsxCode === item.lsxCode)
      const previousTotal = itemLogs
        .filter((l: any) => {
          const lDateStr = l.reportDate instanceof Date
            ? l.reportDate.toISOString().split('T')[0]
            : String(l.reportDate).split('T')[0]
          return lDateStr < todayDateStr
        })
        .reduce((sum: number, l: any) => sum + Number(l.reportedVolume || 0), 0)

      const existingTodayLog = itemLogs.find((l: any) => {
        const lDateStr = l.reportDate instanceof Date
          ? l.reportDate.toISOString().split('T')[0]
          : String(l.reportDate).split('T')[0]
        return lDateStr === todayDateStr
      })

      // Calculate rejected volume from finalized PM weekly acceptances
      const itemAcceptances = acceptanceLogs.filter((al: any) => al.lsxCode === item.lsxCode)
      const totalRejected = itemAcceptances.reduce((sum: number, al: any) => {
        const reported = Number(al.reportedTotal || 0)
        const accepted = Number(al.acceptedVolume || 0)
        return sum + Math.max(0, reported - accepted)
      }, 0)

      // The true accumulated volume is the sum of all reported volumes (before today)
      // MINUS any volume that was explicitly rejected by PM in the past weeks.
      const trueAccumulated = Math.max(0, previousTotal - totalRejected)

      return {
        ...item,
        previousAccumulated: trueAccumulated,
        todayVolume: Number(existingTodayLog?.reportedVolume || 0),
        todayLogId: existingTodayLog?.id || null
      }
    })

    return NextResponse.json({ success: true, items: uniqueLsxItems })

  } catch (err: any) {
    console.error('Daily Report fetch error:', err)
    return NextResponse.json({ success: false, error: 'Lỗi hệ thống khi tải báo cáo' }, { status: 500 })
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const payload = await authenticateRequest(request as any)
  if (!payload) return unauthorizedResponse()
  const authenticatedUserId = payload.userId

  try {
    const task = await prisma.workflowTask.findUnique({
      where: { id: params.id },
      select: { projectId: true, stepCode: true }
    })

    if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (task.stepCode !== 'P5.1' && task.stepCode !== 'P5.1A') return NextResponse.json({ success: false, error: 'Invalid task type' }, { status: 400 })

    const body = await request.json()
    const { items, date } = body as {
      items: { lsxCode: string; wbsStage: string; reportedVolume: number }[]
      date: string
    }

    if (!items || !Array.isArray(items) || !date) {
      return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ' }, { status: 400 })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
      return NextResponse.json({ success: false, error: 'Ngày không hợp lệ (YYYY-MM-DD)' }, { status: 400 })
    }

    const MAX_VOLUME = 1_000_000
    for (const item of items) {
      if (typeof item.reportedVolume !== 'number' || item.reportedVolume < 0 || item.reportedVolume > MAX_VOLUME) {
        return NextResponse.json({ success: false, error: `Khối lượng không hợp lệ cho ${item.lsxCode}: phải từ 0 đến ${MAX_VOLUME.toLocaleString()}` }, { status: 400 })
      }
    }

    const reportDate = new Date(date)
    // Make sure reportDate matches the date in local timezone (strip time components to strictly 00:00 UTC)
    reportDate.setUTCHours(0, 0, 0, 0)

    let savedCount = 0

    // Begin database transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (item.reportedVolume <= 0) continue

        // Check if log already exists for this exact date and lsxCode
        const existingLog = await (tx as any).dailyProductionLog.findFirst({
          where: {
            projectId: task.projectId,
            lsxCode: item.lsxCode,
            reportDate: reportDate
          }
        })

        if (existingLog) {
          // Update
          await (tx as any).dailyProductionLog.update({
            where: { id: existingLog.id },
            data: {
              reportedVolume: item.reportedVolume,
              teamUserId: authenticatedUserId
            }
          })
        } else {
          // Create
          await (tx as any).dailyProductionLog.create({
            data: {
              projectId: task.projectId,
              lsxCode: item.lsxCode,
              wbsStage: item.wbsStage,
              reportDate: reportDate,
              reportedVolume: item.reportedVolume,
              teamUserId: authenticatedUserId
            }
          })
        }
        savedCount++
      }
    })

    return NextResponse.json({ success: true, savedCount, message: `Đã lưu báo cáo cho ${savedCount} công đoạn.` })
  } catch (err: any) {
    console.error('Daily Report save error:', err)
    return NextResponse.json({ success: false, error: 'Lỗi server khi lưu báo cáo' }, { status: 500 })
  }
}

