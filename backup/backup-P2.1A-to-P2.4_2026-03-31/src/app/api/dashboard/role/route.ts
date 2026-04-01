import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/dashboard/role — Role-specific dashboard widgets
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const role = user.roleCode
    const widgets: Record<string, unknown> = { role }

    // Common widgets for all roles
    const [taskCount, notifCount] = await Promise.all([
      prisma.workflowTask.count({ where: { OR: [{ assignedTo: user.userId }, { assignedRole: role }], status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.notification.count({ where: { userId: user.userId, isRead: false } }),
    ])
    widgets.pendingTasks = taskCount
    widgets.unreadNotifications = notifCount

    // Role-specific widgets
    if (['R01', 'R02'].includes(role)) {
      // BGĐ / PM — project overview
      const [projects, overdueCount] = await Promise.all([
        prisma.project.count({ where: { status: { not: 'CLOSED' } } }),
        prisma.workflowTask.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, deadline: { lt: new Date() } } }),
      ])
      widgets.activeProjects = projects
      widgets.overdueTasks = overdueCount

      // R02 PM extra: cost vs budget summary
      if (role === 'R02') {
        const budgets = await prisma.budget.aggregate({ _sum: { planned: true, actual: true } })
        widgets.costSummary = {
          totalPlanned: Number(budgets._sum?.planned || 0),
          totalActual: Number(budgets._sum?.actual || 0),
          variance: Number(budgets._sum?.planned || 0) - Number(budgets._sum?.actual || 0),
        }
      }
    }

    if (['R01', 'R05', 'R07'].includes(role)) {
      // Kho / Thương mại — procurement
      const [pendingPR, pendingPO, allMaterials] = await Promise.all([
        prisma.purchaseRequest.count({ where: { status: 'PENDING' } }),
        prisma.purchaseOrder.count({ where: { status: 'DRAFT' } }),
        prisma.material.findMany({ select: { currentStock: true, minStock: true } }),
      ])
      const lowStock = allMaterials.filter(m => Number(m.currentStock) <= Number(m.minStock)).length
      widgets.pendingPR = pendingPR
      widgets.pendingPO = pendingPO
      widgets.lowStockItems = lowStock
    }

    if (['R01', 'R06', 'R06a', 'R06b'].includes(role)) {
      // SX — production
      const [activeWO, woByStatus] = await Promise.all([
        prisma.workOrder.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.workOrder.groupBy({ by: ['status'], _count: { id: true } }),
      ])
      widgets.activeWorkOrders = activeWO
      widgets.woStatusBreakdown = woByStatus.reduce((acc, g) => ({ ...acc, [g.status]: g._count.id }), {} as Record<string, number>)
    }

    if (['R01', 'R09', 'R09a'].includes(role)) {
      // QC — quality
      const [openNCR, pendingInspections] = await Promise.all([
        prisma.nonConformanceReport.count({ where: { status: { not: 'CLOSED' } } }),
        prisma.inspection.count({ where: { status: 'PENDING' } }),
      ])
      widgets.openNCR = openNCR
      widgets.pendingInspections = pendingInspections
    }

    if (['R01', 'R08', 'R08a'].includes(role)) {
      // Kế toán — finance
      const [unpaidInvoices, pendingPayments] = await Promise.all([
        prisma.invoice.count({ where: { status: { in: ['SENT', 'OVERDUE'] } } }),
        prisma.payment.count({ where: { invoice: { status: { in: ['SENT', 'OVERDUE'] } } } }),
      ])
      widgets.unpaidInvoices = unpaidInvoices
      widgets.pendingPayments = pendingPayments
    }

    if (['R01', 'R03', 'R03a'].includes(role)) {
      // KT-KH — planning & budget
      const [budgetCount, drawingCount] = await Promise.all([
        prisma.budget.count(),
        prisma.drawing.count(),
      ])
      widgets.budgetCount = budgetCount
      widgets.drawingCount = drawingCount

      // R03 extra: monthly piece-rate output count
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)
      const pieceRateCount = await prisma.monthlyPieceRateOutput.count({
        where: { month: startOfMonth.getMonth() + 1, year: startOfMonth.getFullYear() },
      })
      widgets.pieceRateOutputs = pieceRateCount
    }

    if (['R01', 'R04', 'R04a'].includes(role)) {
      // Thiết kế — design
      const [drawings, pendingECO, drawingsByStatus] = await Promise.all([
        prisma.drawing.count(),
        prisma.engineeringChangeOrder.count({ where: { status: 'PENDING' } }),
        prisma.drawing.groupBy({ by: ['status'], _count: { id: true } }),
      ])
      widgets.drawingCount = drawings
      widgets.pendingECO = pendingECO
      widgets.drawingStatusBreakdown = drawingsByStatus.reduce(
        (acc, g) => ({ ...acc, [g.status]: g._count.id }), {} as Record<string, number>
      )
    }

    if (['R01', 'R07', 'R07a'].includes(role)) {
      // Thương mại — delivery tracking
      const deliveryPending = await prisma.deliveryRecord.count({ where: { status: { not: 'RECEIVED' } } })
      widgets.deliveryPending = deliveryPending
    }

    // R01 BGĐ — safety
    if (role === 'R01') {
      const [openSafety, totalIncidents] = await Promise.all([
        prisma.safetyIncident.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
        prisma.safetyIncident.count(),
      ])
      widgets.openSafetyIncidents = openSafety
      widgets.totalSafetyIncidents = totalIncidents
    }

    return successResponse({ widgets })
  } catch (err) {
    console.error('GET /api/dashboard/role error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
