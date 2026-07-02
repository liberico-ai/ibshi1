import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createPaymentSchema } from '@/lib/schemas'
import { formatNumber } from '@/lib/utils'
import { FINANCE_WRITE_ROLES } from '@/lib/constants'
import { recalcBudgetActual } from '@/lib/sync-engine'

// GET /api/finance/payments — list payments with invoice info
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const invoiceId = searchParams.get('invoiceId')
    const page = Number(searchParams.get('page')) || 1
    const limit = 20

    const where: Record<string, unknown> = {}
    if (invoiceId) where.invoiceId = invoiceId

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          invoice: { select: { invoiceCode: true, type: true, clientName: true, totalAmount: true } },
        },
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ])

    const summary = await prisma.payment.aggregate({
      _sum: { amount: true },
      _count: true,
    })

    return successResponse({
      payments,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalPaid: Number(summary._sum.amount || 0),
        totalRecords: summary._count,
      },
    })
  } catch (err) {
    console.error('GET /api/finance/payments error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/finance/payments — create payment and update invoice paidAmount
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(FINANCE_WRITE_ROLES as readonly string[]).includes(user.roleCode)) return forbiddenResponse('Không có quyền ghi tài chính')

    const result = await validateBody(req, createPaymentSchema)
    if (!result.success) return result.response
    const { invoiceId, amount, paymentDate, method, reference, notes } = result.data

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) return errorResponse('Hóa đơn không tồn tại', 404)

    const remaining = Number(invoice.totalAmount) - Number(invoice.paidAmount)
    if (Number(amount) > remaining) {
      return errorResponse(`Số tiền thanh toán vượt quá số còn lại (${formatNumber(remaining)} VNĐ)`)
    }

    // Hướng dòng tiền: hóa đơn RECEIVABLE = THU từ khách; còn lại (PAYABLE/ADVANCE_PAYMENT) = CHI
    const isOutflow = invoice.type !== 'RECEIVABLE'
    const newPaid = Number(invoice.paidAmount) + Number(amount)
    const newStatus = newPaid >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL'

    // Payment + cập nhật invoice + CashflowEntry trong CÙNG transaction
    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          invoiceId,
          amount: Number(amount),
          paymentDate: new Date(paymentDate),
          method: method || 'BANK_TRANSFER',
          reference,
          notes,
        },
      })

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaid, status: newStatus },
      })

      // Mỗi payment sinh đúng 1 CashflowEntry (entryCode theo payment.id — không nhân đôi)
      await tx.cashflowEntry.create({
        data: {
          entryCode: `CF-PAY-${p.id}`,
          type: isOutflow ? 'OUTFLOW' : 'INFLOW',
          category: isOutflow ? 'VENDOR_PAYMENT' : 'CUSTOMER_RECEIPT',
          amount: Number(amount),
          description: `Thanh toán hóa đơn ${invoice.invoiceCode}`,
          entryDate: new Date(paymentDate),
          reference: p.id,
          projectId: invoice.projectId,
        },
      })

      return p
    })

    // Thực chi cho dự án → recompute actual (nguồn duy nhất: recalcBudgetActual)
    if (isOutflow && invoice.projectId) {
      try { await recalcBudgetActual(invoice.projectId, user.userId) }
      catch (e) { console.error('[Payments] recalcBudgetActual error:', e) }
    }

    return successResponse({ payment, invoiceStatus: newStatus }, 'Thanh toán thành công')
  } catch (err) {
    console.error('POST /api/finance/payments error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
