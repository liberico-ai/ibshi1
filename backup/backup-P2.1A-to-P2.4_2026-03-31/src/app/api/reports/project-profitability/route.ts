import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/reports/project-profitability — per-project P&L
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const projects = await prisma.project.findMany({
      include: {
        invoices: { select: { type: true, totalAmount: true, paidAmount: true } },
        budgets: { select: { category: true, planned: true, actual: true } },
        cashflows: { select: { type: true, amount: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const report = projects.map(p => {
      const revenue = p.invoices
        .filter(i => i.type === 'RECEIVABLE')
        .reduce((s, i) => s + Number(i.totalAmount), 0)
      const costs = p.invoices
        .filter(i => i.type === 'PAYABLE')
        .reduce((s, i) => s + Number(i.totalAmount), 0)
      const cashIn = p.cashflows
        .filter(c => c.type === 'INFLOW')
        .reduce((s, c) => s + Number(c.amount), 0)
      const cashOut = p.cashflows
        .filter(c => c.type === 'OUTFLOW')
        .reduce((s, c) => s + Number(c.amount), 0)
      const budgetPlanned = p.budgets.reduce((s, b) => s + Number(b.planned), 0)
      const budgetActual = p.budgets.reduce((s, b) => s + Number(b.actual), 0)

      const contractValue = Number(p.contractValue || 0)
      const grossProfit = contractValue - costs
      const margin = contractValue > 0 ? Math.round(grossProfit / contractValue * 100) : 0

      return {
        id: p.id,
        projectCode: p.projectCode,
        projectName: p.projectName,
        clientName: p.clientName,
        status: p.status,
        contractValue,
        revenue,
        costs,
        grossProfit,
        margin,
        cashIn,
        cashOut,
        netCashflow: cashIn - cashOut,
        budgetPlanned,
        budgetActual,
        budgetVariance: budgetPlanned - budgetActual,
      }
    })

    const totals = report.reduce((acc, r) => ({
      contractValue: acc.contractValue + r.contractValue,
      revenue: acc.revenue + r.revenue,
      costs: acc.costs + r.costs,
      grossProfit: acc.grossProfit + r.grossProfit,
      cashIn: acc.cashIn + r.cashIn,
      cashOut: acc.cashOut + r.cashOut,
    }), { contractValue: 0, revenue: 0, costs: 0, grossProfit: 0, cashIn: 0, cashOut: 0 })

    return successResponse({ projects: report, totals })
  } catch (err) {
    console.error('GET /api/reports/project-profitability error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
