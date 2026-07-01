import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ saleCustomerId: string }> },
) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:ar')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const { saleCustomerId } = await params

  const projects = await prisma.project.findMany({
    where: { saleCustomerId },
    select: { id: true },
  })

  if (projects.length === 0) {
    return successResponse({
      data: {
        saleCustomerId,
        projectCount: 0,
        currentOutstandingVnd: 0,
        avgDaysToPay: null,
        lateCount12mo: 0,
        paymentGrade: 'UNKNOWN',
      },
    })
  }

  const projectIds = projects.map(p => p.id)

  const invoices = await prisma.invoice.findMany({
    where: { projectId: { in: projectIds }, type: 'RECEIVABLE' },
    select: {
      id: true, totalAmount: true, paidAmount: true, dueDate: true, status: true,
      payments: { select: { paymentDate: true, amount: true } },
      issueDate: true,
    },
  })

  const currentOutstandingVnd = invoices.reduce(
    (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
    0,
  )

  const now = new Date()
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())

  let totalDays = 0
  let paidCount = 0
  let lateCount12mo = 0

  for (const inv of invoices) {
    if (inv.payments.length > 0) {
      const lastPayment = inv.payments.reduce((a, b) =>
        new Date(a.paymentDate) > new Date(b.paymentDate) ? a : b,
      )
      const issueDate = new Date(inv.issueDate)
      const payDate = new Date(lastPayment.paymentDate)
      const days = Math.floor((payDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24))
      if (days >= 0) {
        totalDays += days
        paidCount++
      }
      if (inv.dueDate && payDate > new Date(inv.dueDate) && payDate >= oneYearAgo) {
        lateCount12mo++
      }
    }
  }

  const avgDaysToPay = paidCount > 0 ? Math.round(totalDays / paidCount) : null

  let paymentGrade: string
  if (paidCount === 0) paymentGrade = 'UNKNOWN'
  else if (lateCount12mo === 0 && avgDaysToPay !== null && avgDaysToPay <= 30) paymentGrade = 'A'
  else if (lateCount12mo <= 2 && avgDaysToPay !== null && avgDaysToPay <= 60) paymentGrade = 'B'
  else if (lateCount12mo <= 5) paymentGrade = 'C'
  else paymentGrade = 'D'

  return successResponse({
    data: {
      saleCustomerId,
      projectCount: projects.length,
      currentOutstandingVnd: Math.round(currentOutstandingVnd),
      avgDaysToPay,
      lateCount12mo,
      paymentGrade,
    },
  })
}
