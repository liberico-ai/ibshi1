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

    // ──── P-02: Project Progress ────
    if (type === 'project-progress') {
      const projects = await prisma.project.findMany({
        where: { status: { not: 'CLOSED' } },
        select: { id: true, projectCode: true, projectName: true, clientName: true, status: true },
      })
      const projectProgress = await Promise.all(
        projects.map(async (p) => {
          const [total, done, overdue] = await Promise.all([
            prisma.workflowTask.count({ where: { projectId: p.id } }),
            prisma.workflowTask.count({ where: { projectId: p.id, status: 'DONE' } }),
            prisma.workflowTask.count({ where: { projectId: p.id, status: { not: 'DONE' }, deadline: { lt: new Date() } } }),
          ])
          return { ...p, totalTasks: total, completedTasks: done, overdueTasks: overdue, percentage: total > 0 ? Math.round((done / total) * 100) : 0 }
        })
      )
      return successResponse({ projects: projectProgress.sort((a, b) => b.percentage - a.percentage) })
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
