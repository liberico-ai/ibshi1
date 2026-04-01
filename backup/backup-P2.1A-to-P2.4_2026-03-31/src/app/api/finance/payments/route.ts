import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

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

    const body = await req.json()
    const { invoiceId, amount, paymentDate, method, reference, notes } = body

    if (!invoiceId || !amount || !paymentDate) {
      return errorResponse('Thiếu thông tin: invoiceId, amount, paymentDate')
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) return errorResponse('Hóa đơn không tồn tại', 404)

    const remaining = Number(invoice.totalAmount) - Number(invoice.paidAmount)
    if (Number(amount) > remaining) {
      return errorResponse(`Số tiền thanh toán vượt quá số còn lại (${remaining.toLocaleString('vi-VN')} VNĐ)`)
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId,
        amount: Number(amount),
        paymentDate: new Date(paymentDate),
        method: method || 'BANK_TRANSFER',
        reference,
        notes,
      },
    })

    // Update invoice paidAmount and status
    const newPaid = Number(invoice.paidAmount) + Number(amount)
    const newStatus = newPaid >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL'
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount: newPaid, status: newStatus },
    })

    return successResponse({ payment, invoiceStatus: newStatus }, 'Thanh toán thành công')
  } catch (err) {
    console.error('POST /api/finance/payments error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
