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
      // 1. Lấy tất cả dự án đang chạy
      const projects = await prisma.project.findMany({
        where: { status: { not: 'CLOSED' } },
        select: { id: true, projectCode: true, projectName: true },
        orderBy: { createdAt: 'desc' }
      })
      const projectIds = projects.map(p => p.id)

      // 2. Lấy dữ liệu WBS từ P1.2A (plan step) — đây là nơi lưu wbsItems
      const p12aTasks = await prisma.workflowTask.findMany({
        where: { projectId: { in: projectIds }, stepCode: 'P1.2A' },
        select: { projectId: true, resultData: true },
        orderBy: { createdAt: 'desc' },
      })
      const p3Map = new Map<string, any>()
      for (const pt of p12aTasks) {
        if (!p3Map.has(pt.projectId)) p3Map.set(pt.projectId, pt.resultData) // Keep most recent
      }


      // 3. Lấy báo cáo hàng ngày (T2-T6) để CỘNG DỒN SL Sản xuất
      const dailyLogs = await (prisma as any).dailyProductionLog.findMany({
        where: { projectId: { in: projectIds } }
      })

      // 4. Lấy nhật ký nghiệm thu tuần để CỘNG DỒN KL Xác nhận
      const weeklyLogs = await (prisma as any).weeklyAcceptanceLog.findMany({
        where: { projectId: { in: projectIds }, role: 'PM' } // Chốt cuối cùng là số của PM
      })

      const STAGE_LABELS: Record<string, string> = {
        cutting: 'Pha cắt', fitup: 'Gá lắp', welding: 'Hàn',
        machining: 'Gia công cơ khí', tryAssembly: 'Thử lắp ráp',
        dismantle: 'Tháo dỡ', blasting: 'Bắn bi / Làm sạch',
        painting: 'Sơn phủ', insulation: 'Bảo ôn', packing: 'Đóng kiện',
        delivery: 'Giao hàng',
      }

      const parseVolumeStr = (v: any): number => {
        if (typeof v === 'number') return v
        if (!v || typeof v !== 'string') return 0
        return Number(String(v).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0
      }

      const weeklyDataMap = new Map<string, any>()

      for (const p of projects) {
        const pCode = p.projectCode
        let totalProj = 0
        const hmMap = new Map<string, any>()

        const p3Data = p3Map.get(p.id) || {}
        let wbsItems: any[] = []
        try { wbsItems = JSON.parse(p3Data.wbsItems as string || '[]') } catch { wbsItems = [] }

        // Gộp tất cả mã lsxCode từ cả bảng daily lẫn weekly
        const stageKeysSet = new Set<string>()
        dailyLogs.filter((d: any) => d.projectId === p.id).forEach((d: any) => stageKeysSet.add(d.lsxCode))
        weeklyLogs.filter((w: any) => w.projectId === p.id).forEach((w: any) => stageKeysSet.add(w.lsxCode))

        for (const lsxCode of Array.from(stageKeysSet)) {
          const parts = lsxCode.split('_')
          const wbsIndex = parseInt(parts[0] || '0')
          const wbsInfo = wbsItems[wbsIndex] || {}

          const hangMucName = wbsInfo.hangMuc || 'Hạng mục chung'
          const wbsStageKey = parts.slice(1).join('_') || ''
          const stageLabelDetail = wbsInfo.congDoan?.find((c: any) => c.key === wbsStageKey)
          const stageName = stageLabelDetail?.label || STAGE_LABELS[wbsStageKey] || wbsStageKey || 'Công đoạn chung'
          
          if (!hmMap.has(hangMucName)) {
            hmMap.set(hangMucName, { name: hangMucName, stages: new Map(), totalHm: 0 })
          }
          const hmNode = hmMap.get(hangMucName)

          if (!hmNode.stages.has(stageName)) {
            hmNode.stages.set(stageName, {
              name: stageName,
              weeks: {},
              total: 0,
              totalAssigned: parseVolumeStr(wbsInfo.khoiLuong) || 0,
              totalProduced: 0,
              totalRemaining: 0
            })
          }
          const stgNode = hmNode.stages.get(stageName)

          // TÍNH LŨY KẾ SL SẢN XUẤT (Cộng Dồn tất cả T2-T6)
          const allDaily = dailyLogs.filter((d: any) => d.projectId === p.id && d.lsxCode === lsxCode)
          const sumDaily = allDaily.reduce((sum: number, d: any) => sum + Number(d.reportedVolume), 0)
          // Since multiple lsxCodes might map to the SAME stageName (if they have different WBS rows but same stage string?),
          // Wait, the maps are nested by HangMuc -> StageName. So we must accumulate totalProduced.
          stgNode.totalProduced += sumDaily

          // TÍNH LŨY KẾ NGHIỆM THU TUẦN
          const allWeekly = weeklyLogs.filter((w: any) => w.projectId === p.id && w.lsxCode === lsxCode)
          for (const w of allWeekly) {
            const weekKey = `Tuần ${w.weekNumber}`
            const acceptedVal = Number(w.acceptedVolume) || 0
            stgNode.weeks[weekKey] = (stgNode.weeks[weekKey] || 0) + acceptedVal
            stgNode.total += acceptedVal
            hmNode.totalHm += acceptedVal
            totalProj += acceptedVal
          }

          stgNode.totalRemaining = Math.max(0, stgNode.totalAssigned - stgNode.total)
        }

        if (hmMap.size > 0) {
          weeklyDataMap.set(pCode, {
            projectCode: pCode,
            projectName: p.projectName,
            hangMucs: hmMap,
            totalProj
          })
        }
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
