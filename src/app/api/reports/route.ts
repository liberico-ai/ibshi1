import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/reports — Aggregated reports data — supports 13+ report types
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'overview'

    // ──── P-00: Overview ────
    if (type === 'overview') {
      const [projectCount, activeProjects, closedProjects, totalTasks, completedTasks, overdueTasks, activeWO, openNCR] = await Promise.all([
        prisma.project.count(),
        prisma.project.count({ where: { status: { not: 'CLOSED' } } }),
        prisma.project.count({ where: { status: 'CLOSED' } }),
        prisma.workflowTask.count(),
        prisma.workflowTask.count({ where: { status: 'DONE' } }),
        prisma.workflowTask.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, deadline: { lt: new Date() } } }),
        prisma.workOrder.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.nonConformanceReport.count({ where: { status: { not: 'CLOSED' } } }),
      ])
      return successResponse({
        overview: { projectCount, activeProjects, closedProjects, totalTasks, completedTasks, overdueTasks,
          taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0, activeWO, openNCR },
      })
    }

    // ──── P-02: Project Progress (Weekly Volume from P5.4) ────
    if (type === 'project-progress') {
      // 1. Get all completed P5.4 tasks
      const p54Tasks = await prisma.workflowTask.findMany({
        where: { stepCode: 'P5.4', status: 'DONE' },
        include: { project: { select: { projectCode: true, projectName: true } } },
        orderBy: { completedAt: 'asc' },
      })

      // 2. Get all P5.1 tasks to read lsxData (hangMuc, volume, stageLabel) and completedQuantity
      const p51Ids = [...new Set(p54Tasks.map(t => ((t.resultData as any)?.sourceP51TaskId as string)).filter(Boolean))]
      const projectIds = [...new Set(p54Tasks.map(t => t.projectId))]

      const [p51Tasks, allP51Tasks] = await Promise.all([
        prisma.workflowTask.findMany({
          where: { id: { in: p51Ids } },
          select: { id: true, resultData: true, projectId: true },
        }),
        prisma.workflowTask.findMany({
          where: { projectId: { in: projectIds }, stepCode: 'P5.1', status: 'DONE' },
          select: { id: true, resultData: true, projectId: true },
        }),
      ])
      const p51Map = new Map(p51Tasks.map(t => [t.id, t.resultData as any]))

      // 3. Get P3.3/P3.4 cellAssignments for totalAssigned volume per stage
      const p3Tasks = await prisma.workflowTask.findMany({
        where: { projectId: { in: projectIds }, stepCode: { in: ['P3.3', 'P3.4'] } },
        select: { projectId: true, resultData: true },
        orderBy: { createdAt: 'desc' },
      })
      const p3Map = new Map<string, any>()
      for (const pt of p3Tasks) {
        if (!p3Map.has(pt.projectId)) p3Map.set(pt.projectId, pt.resultData)
      }

      // 4. Get P4.5 tasks for sourceRow lookup
      const allP45Ids = [...new Set([
        ...p54Tasks.map(t => ((t.resultData as any)?.sourceP45TaskId as string)),
        ...allP51Tasks.map(t => ((t.resultData as any)?.sourceP45TaskId as string)),
      ].filter(Boolean))]
      const p45Tasks = await prisma.workflowTask.findMany({
        where: { id: { in: allP45Ids } },
        select: { id: true, resultData: true },
      })
      const p45Map = new Map(p45Tasks.map(t => [t.id, t.resultData as any]))

      // 5. Helper: get sourceRow from P4.5
      const getSourceRow = (p45Id: string | undefined): number | null => {
        if (!p45Id) return null
        const p45Data = p45Map.get(p45Id)
        if (!p45Data) return null
        const req = (p45Data.materialIssueRequests as Array<any>)?.[0]
        return req?.sourceRow ?? null
      }

      // 6. Get plan data for WBS hang muc names
      const planTasks = await prisma.workflowTask.findMany({
        where: { projectId: { in: projectIds }, stepCode: { in: ['P1.3', 'P1.2A'] } },
        select: { projectId: true, resultData: true },
        orderBy: { createdAt: 'desc' },
      })
      const planMap = new Map<string, any>()
      for (const pt of planTasks) {
        if (!planMap.has(pt.projectId)) planMap.set(pt.projectId, pt.resultData)
      }

      const getWbsItemName = (projectId: string, sourceRow: number | null): string => {
        if (sourceRow == null) return 'Hạng mục chung'
        const planData = planMap.get(projectId) || {}
        try {
          const wbsRaw = planData.wbsItems as string | undefined
          if (wbsRaw) {
            const wbsList = JSON.parse(wbsRaw)
            return wbsList[Number(sourceRow)]?.hangMuc || 'Hạng mục chung'
          }
        } catch { /* ignore */ }
        return 'Hạng mục chung'
      }

      const STAGE_LABELS: Record<string, string> = {
        cutting: 'Pha cắt', fitup: 'Gá lắp', welding: 'Hàn',
        machining: 'Gia công cơ khí', tryAssembly: 'Thử lắp ráp',
        dismantle: 'Tháo dỡ', blasting: 'Bắn bi / Làm sạch',
        painting: 'Sơn phủ', insulation: 'Bảo ôn', packing: 'Đóng kiện',
        delivery: 'Giao hàng',
      }

      const weeklyDataMap = new Map<string, any>()

      const getWeek = (d: Date) => {
        const date = new Date(d.getTime())
        date.setHours(0, 0, 0, 0)
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7)
        const week1 = new Date(date.getFullYear(), 0, 4)
        return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7)
      }

      // Helper: parse volume string like "2000 kg" or "2,268.93 kg" to number
      const parseVolumeStr = (v: any): number => {
        if (typeof v === 'number') return v
        if (!v || typeof v !== 'string') return 0
        return Number(String(v).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0
      }

      for (const t of p54Tasks) {
        if (!t.completedAt) continue
        const rd = (t.resultData as any) || {}
        const vol = Number(rd.pmConfirmedVolume ?? rd.completedQuantity) || 0
        if (vol <= 0) continue

        // Read P5.1 data for this P5.4
        const p51Id = rd.sourceP51TaskId as string
        const p51Data = p51Id ? p51Map.get(p51Id) : null
        const lsxData = p51Data?.lsxData || {}
        const stageKey = rd.stageKey || p51Data?.stageKey || ''
        const p45Id = rd.sourceP45TaskId || p51Data?.sourceP45TaskId
        const sourceRow = getSourceRow(p45Id)

        const pCode = t.project.projectCode
        const pName = t.project.projectName

        // Hang muc: prefer WBS plan data (correct category), fallback to lsxData
        const wbsHangMuc = getWbsItemName(t.projectId, sourceRow)
        const hangMuc = wbsHangMuc !== 'Hạng mục chung' ? wbsHangMuc : (lsxData.items?.[0]?.hangMuc || 'Hạng mục chung')
        const stageName = STAGE_LABELS[stageKey] || lsxData.stageLabel || stageKey || 'Công đoạn chung'
        
        const weekKey = `Tuần ${getWeek(new Date(t.completedAt))}`

        if (!weeklyDataMap.has(pCode)) {
          weeklyDataMap.set(pCode, { projectCode: pCode, projectName: pName, hangMucs: new Map(), totalProj: 0 })
        }
        const projNode = weeklyDataMap.get(pCode)
        projNode.totalProj += vol

        if (!projNode.hangMucs.has(hangMuc)) {
          projNode.hangMucs.set(hangMuc, { name: hangMuc, stages: new Map(), totalHm: 0 })
        }
        const hmNode = projNode.hangMucs.get(hangMuc)
        hmNode.totalHm += vol

        if (!hmNode.stages.has(stageName)) {
          // totalAssigned = WBS item's khoiLuong (total volume for this hang muc)
          let totalAssigned = 0
          if (sourceRow != null) {
            const planData = planMap.get(t.projectId) || {}
            try {
              const wbsRaw = planData.wbsItems as string | undefined
              if (wbsRaw) {
                const wbsList = JSON.parse(wbsRaw)
                totalAssigned = parseVolumeStr(wbsList[Number(sourceRow)]?.khoiLuong)
              }
            } catch { /* ignore */ }
          }
          // Fallback: use lsxData volume from P5.1
          if (totalAssigned === 0 && lsxData.items?.[0]?.volume) {
            totalAssigned = parseVolumeStr(lsxData.items[0].volume)
          }

          // totalProduced: sum completedQuantity from all P5.1 tasks with same stageKey + sourceRow
          const totalProduced = allP51Tasks.filter(p51 => {
            if (p51.projectId !== t.projectId) return false
            const p51rd = (p51.resultData as any) || {}
            if (p51rd.stageKey !== stageKey) return false
            // If we have sourceRow, match on it via P4.5
            if (sourceRow != null) {
              const p51SourceRow = getSourceRow(p51rd.sourceP45TaskId)
              return p51SourceRow === sourceRow
            }
            return true // same project + same stage
          }).reduce((s, p51) => s + (Number((p51.resultData as any)?.completedQuantity) || 0), 0)

          hmNode.stages.set(stageName, { name: stageName, weeks: {}, total: 0, totalAssigned, totalProduced, totalRemaining: 0 })
        }

        const stgNode = hmNode.stages.get(stageName)
        stgNode.total += vol
        stgNode.weeks[weekKey] = (stgNode.weeks[weekKey] || 0) + vol
        // Còn lại cần TH = SL phân giao (WBS) - KL xác nhận (P5.4)
        stgNode.totalRemaining = stgNode.totalAssigned - stgNode.total
      }

      // Convert Maps to Arrays for JSON response structure
      const weeklyData = Array.from(weeklyDataMap.values()).map(proj => ({
        ...proj,
        hangMucs: Array.from(proj.hangMucs.values()).map((hm: any) => ({
          ...hm,
          stages: Array.from(hm.stages.values())
        }))
      }))

      // Find all unique weeks that have data across entire dataset
      const weekKeysSet = new Set<string>()
      weeklyData.forEach(p => p.hangMucs.forEach((h: any) => h.stages.forEach((s: any) => Object.keys(s.weeks).forEach(w => weekKeysSet.add(w)))))
      // Just take them as sorted array (Tuần 1, Tuần 2...)
      const weekKeys = Array.from(weekKeysSet).sort((a, b) => {
        const numA = parseInt(a.replace('Tuần ', '')) || 0
        const numB = parseInt(b.replace('Tuần ', '')) || 0
        return numA - numB
      })
      // Ensure at least Tuần 1-4 exists for aesthetic reasons, if empty
      if (weekKeys.length === 0) {
        weekKeys.push('Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4')
      }

      return successResponse({ weeklyData, weekKeys })
    }

    // ──── P-05 / TC-01: Financial — Budget vs Actual ────
    if (type === 'financial') {
      const projects = await prisma.project.findMany({
        select: { id: true, projectCode: true, projectName: true, contractValue: true },
      })
      const financialData = await Promise.all(
        projects.filter(p => p.contractValue).map(async (p) => {
          const budgets = await prisma.budget.aggregate({ where: { projectId: p.id }, _sum: { planned: true, actual: true } })
          const invoices = await prisma.invoice.aggregate({ where: { projectId: p.id, status: 'PAID' }, _sum: { totalAmount: true } })
          const planned = Number(budgets._sum?.planned || 0)
          const actual = Number(budgets._sum?.actual || 0)
          return {
            ...p, contractValue: Number(p.contractValue), budgetPlanned: planned, budgetActual: actual,
            invoicedTotal: Number(invoices._sum?.totalAmount || 0), variance: planned - actual,
            variancePct: planned > 0 ? Math.round(((planned - actual) / planned) * 100) : 0,
          }
        })
      )
      return successResponse({ financial: financialData })
    }

    // ──── SX-01: Work Order Status ────
    if (type === 'production') {
      const statuses = ['OPEN', 'IN_PROGRESS', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'ON_HOLD', 'COMPLETED', 'CANCELLED']
      const counts = await Promise.all(statuses.map(s => prisma.workOrder.count({ where: { status: s } })))
      const statusBreakdown = Object.fromEntries(statuses.map((s, i) => [s, counts[i]]))
      const total = counts.reduce((a, b) => a + b, 0)
      const teamStats = await prisma.workOrder.groupBy({ by: ['teamCode'], _count: true })
      return successResponse({ production: { total, statusBreakdown, byTeam: teamStats } })
    }

    // ──── QC-01: Inspection Summary ────
    if (type === 'qc') {
      const [totalInsp, passedInsp, failedInsp, openNCR, closedNCR, totalCerts] = await Promise.all([
        prisma.inspection.count(),
        prisma.inspection.count({ where: { status: 'PASSED' } }),
        prisma.inspection.count({ where: { status: 'FAILED' } }),
        prisma.nonConformanceReport.count({ where: { status: { not: 'CLOSED' } } }),
        prisma.nonConformanceReport.count({ where: { status: 'CLOSED' } }),
        prisma.certificateRegistry.count(),
      ])
      return successResponse({
        qc: { totalInspections: totalInsp, passed: passedInsp, failed: failedInsp,
          passRate: totalInsp > 0 ? Math.round((passedInsp / totalInsp) * 100) : 0,
          openNCR, closedNCR, totalCertificates: totalCerts },
      })
    }

    // ──── KH-01: Stock Status ────
    if (type === 'warehouse') {
      const materials = await prisma.material.findMany({
        select: { materialCode: true, name: true, unit: true, currentStock: true, minStock: true },
      })
      const lowStock = materials.filter(m => Number(m.currentStock) <= Number(m.minStock))
      const totalMaterials = materials.length
      const [totalIN, totalOUT] = await Promise.all([
        prisma.stockMovement.count({ where: { type: 'IN' } }),
        prisma.stockMovement.count({ where: { type: 'OUT' } }),
      ])
      return successResponse({
        warehouse: {
          totalMaterials, lowStockCount: lowStock.length,
          lowStockItems: lowStock.map(m => ({ ...m, currentStock: Number(m.currentStock), minStock: Number(m.minStock) })),
          totalMovementsIN: totalIN, totalMovementsOUT: totalOUT,
        },
      })
    }

    // ──── HR-01: Employee Summary ────
    if (type === 'hr') {
      const [totalEmployees, activeEmployees, totalContracts, departments] = await Promise.all([
        prisma.employee.count(),
        prisma.employee.count({ where: { status: 'ACTIVE' } }),
        prisma.employeeContract.count(),
        prisma.department.findMany({ select: { code: true, name: true, _count: { select: { employees: true } } } }),
      ])
      return successResponse({
        hr: { totalEmployees, activeEmployees, totalContracts,
          departments: departments.map((d: { code: string; name: string; _count: { employees: number } }) => ({ code: d.code, name: d.name, count: d._count.employees })) },
      })
    }

    // ──── EX-02: KPI Dashboard ────
    if (type === 'kpi') {
      const [totalTasks, doneTasks, overdueTasks, totalInsp, passedInsp, totalWO, completedWO] = await Promise.all([
        prisma.workflowTask.count(),
        prisma.workflowTask.count({ where: { status: 'DONE' } }),
        prisma.workflowTask.count({ where: { status: { not: 'DONE' }, deadline: { lt: new Date() } } }),
        prisma.inspection.count(),
        prisma.inspection.count({ where: { status: 'PASSED' } }),
        prisma.workOrder.count(),
        prisma.workOrder.count({ where: { status: 'COMPLETED' } }),
      ])
      const taskRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
      const otdRate = totalTasks > 0 ? Math.round(((doneTasks - overdueTasks) / Math.max(doneTasks, 1)) * 100) : 0
      const ncrRate = totalInsp > 0 ? Math.round(((totalInsp - passedInsp) / totalInsp) * 100) : 0
      const woRate = totalWO > 0 ? Math.round((completedWO / totalWO) * 100) : 0
      return successResponse({
        kpi: { taskCompletionRate: taskRate, onTimeDelivery: otdRate, ncrRate, woCompletionRate: woRate },
      })
    }

    // ──── Safety Summary ────
    if (type === 'safety') {
      const [total, open, investigating, resolved, closed] = await Promise.all([
        prisma.safetyIncident.count(),
        prisma.safetyIncident.count({ where: { status: 'OPEN' } }),
        prisma.safetyIncident.count({ where: { status: 'INVESTIGATING' } }),
        prisma.safetyIncident.count({ where: { status: 'RESOLVED' } }),
        prisma.safetyIncident.count({ where: { status: 'CLOSED' } }),
      ])
      const bySeverity = await prisma.safetyIncident.groupBy({ by: ['severity'], _count: true })
      return successResponse({
        safety: { total, open, investigating, resolved, closed,
          bySeverity: Object.fromEntries(bySeverity.map(s => [s.severity, s._count])) },
      })
    }

    // ──── Procurement Summary ────
    if (type === 'procurement') {
      const [totalPR, approvedPR, pendingPR, totalPO, approvedPO, pendingPO] = await Promise.all([
        prisma.purchaseRequest.count(),
        prisma.purchaseRequest.count({ where: { status: 'APPROVED' } }),
        prisma.purchaseRequest.count({ where: { status: 'PENDING' } }),
        prisma.purchaseOrder.count(),
        prisma.purchaseOrder.count({ where: { status: 'APPROVED' } }),
        prisma.purchaseOrder.count({ where: { status: 'PENDING' } }),
      ])
      const poAgg = await prisma.purchaseOrder.aggregate({ _sum: { totalValue: true } })
      const recentPOs = await prisma.purchaseOrder.findMany({
        take: 10, orderBy: { createdAt: 'desc' },
        include: { vendor: { select: { name: true } } },
      })
      return successResponse({
        procurement: {
          totalPR, approvedPR, pendingPR, totalPO, approvedPO, pendingPO,
          totalPOValue: Number(poAgg._sum?.totalValue || 0),
          recentPOs: recentPOs.map(po => ({ poNumber: po.poCode, vendorName: po.vendor?.name || '—', totalAmount: Number(po.totalValue || 0), status: po.status })),
        },
      })
    }

    return errorResponse('Type không hợp lệ: overview, project-progress, financial, production, qc, warehouse, hr, kpi, safety, procurement')
  } catch (err) {
    console.error('GET /api/reports error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
