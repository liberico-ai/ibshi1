import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/finance/budgets/variance — Budget vs Actual variance for project
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    if (!projectId) return errorResponse('Thiếu projectId')

    // Get budget records for the project
    const budgets = await prisma.budget.findMany({
      where: { projectId },
      orderBy: { category: 'asc' },
    })

    // Get actual costs - PO doesn't have projectId, so aggregate from invoices
    const invoiceTotals = await prisma.invoice.aggregate({
      where: { projectId, status: { in: ['SENT', 'PAID', 'OVERDUE'] } },
      _sum: { totalAmount: true },
    })

    // Get payments
    const payments = await prisma.payment.aggregate({
      where: { invoice: { projectId } },
      _sum: { amount: true },
    })

    const totalBudget = budgets.reduce((sum: number, b) => sum + Number(b.planned || 0), 0)
    const totalActualPO = Number(invoiceTotals._sum?.totalAmount || 0)
    const totalPaid = Number(payments._sum?.amount || 0)
    const totalActual = budgets.reduce((sum: number, b) => sum + Number(b.actual || 0), 0)
    const variance = totalBudget - totalActual
    const variancePercent = totalBudget > 0 ? Math.round((variance / totalBudget) * 100) : 0

    return successResponse({
      projectId,
      totalBudget,
      totalActualPO,
      totalActual,
      totalPaid,
      variance,
      variancePercent,
      status: variance >= 0 ? 'UNDER_BUDGET' : 'OVER_BUDGET',
      budgetLines: budgets.map(b => ({
        category: b.category,
        planned: Number(b.planned || 0),
        committed: Number(b.committed || 0),
        actual: Number(b.actual || 0),
        variance: Number(b.planned || 0) - Number(b.actual || 0),
      })),
    })
  } catch (err) {
    console.error('GET /api/finance/budgets/variance error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
