import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { validateQuery } from '@/lib/api-helpers'
import { searchFilterSchema } from '@/lib/schemas'

// GET /api/finance/invoices
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const qResult = validateQuery(req.url, searchFilterSchema)
    if (!qResult.success) return qResult.response
    const { page, search, status } = qResult.data
    const type = new URL(req.url).searchParams.get('type') || ''
    const limit = 20

    const where: Record<string, unknown> = {}
    if (type) where.type = type
    if (status) where.status = status
    if (search) where.OR = [
      { invoiceCode: { contains: search, mode: 'insensitive' } },
      { clientName: { contains: search, mode: 'insensitive' } },
    ]

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where: where as never,
        include: { project: { select: { projectCode: true, projectName: true } }, payments: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.invoice.count({ where: where as never }),
    ])

    // Summary totals
    const allInvoices = await prisma.invoice.findMany({ where: where as never, select: { totalAmount: true, paidAmount: true, type: true } })
    const receivable = allInvoices.filter(i => i.type === 'RECEIVABLE').reduce((s, i) => s + Number(i.totalAmount), 0)
    const payable = allInvoices.filter(i => i.type === 'PAYABLE').reduce((s, i) => s + Number(i.totalAmount), 0)
    const paid = allInvoices.reduce((s, i) => s + Number(i.paidAmount), 0)

    return successResponse({
      invoices, totals: { receivable, payable, paid, outstanding: receivable + payable - paid },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/finance/invoices error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/finance/invoices
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!['R01', 'R02'].includes(user.roleCode)) {
      return forbiddenResponse('Không có quyền')
    }

    const body = await req.json()
    const { invoiceCode, projectId, vendorId, poId, type, clientName, description, amount, dueDate } = body

    if (!invoiceCode || !type || !amount) return errorResponse('Thiếu thông tin', 400)

    const numAmount = Number(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0) return errorResponse('Số tiền không hợp lệ', 400)

    // Tôn trọng taxRate client gửi (kể cả 0). Chỉ default 10% khi không gửi / rỗng.
    // Lưu ý falsy: KHÔNG dùng || (0 sẽ bị ép về 10) — dùng ?? + check chuỗi rỗng (form gửi string).
    const rawTaxRate = body.taxRate ?? null
    const numTaxRate = rawTaxRate === null || rawTaxRate === '' ? 10 : Number(rawTaxRate)
    if (!Number.isFinite(numTaxRate) || numTaxRate < 0 || numTaxRate > 100) {
      return errorResponse('Thuế suất (taxRate) không hợp lệ (0–100)', 400)
    }

    const rawTaxAmount = body.taxAmount ?? null
    const taxAmount = rawTaxAmount === null || rawTaxAmount === ''
      ? Math.round(numAmount * numTaxRate / 100)
      : Number(rawTaxAmount)
    if (!Number.isFinite(taxAmount) || taxAmount < 0) return errorResponse('Tiền thuế (taxAmount) không hợp lệ', 400)

    const expectedTotal = numAmount + taxAmount
    const rawTotalAmount = body.totalAmount ?? null
    const totalAmount = rawTotalAmount === null || rawTotalAmount === '' ? expectedTotal : Number(rawTotalAmount)
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return errorResponse('Tổng tiền (totalAmount) không hợp lệ', 400)
    // Chống số mâu thuẫn: totalAmount client gửi phải khớp amount + taxAmount (dung sai 1đ)
    if (Math.abs(totalAmount - expectedTotal) > 1) {
      return errorResponse(`Tổng tiền không khớp: totalAmount = ${totalAmount} nhưng amount + taxAmount = ${expectedTotal}`, 400)
    }

    const invoice = await prisma.invoice.create({
      data: {
        invoiceCode, projectId: projectId || null, vendorId: vendorId || null,
        poId: poId || null,
        type, clientName: clientName || null, description: description || null,
        amount: numAmount, taxRate: numTaxRate, taxAmount, totalAmount,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    })

    return successResponse({ invoice, ok: true }, 'Tạo hóa đơn thành công', 201)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      return errorResponse('Mã hóa đơn đã tồn tại', 409)
    }
    console.error('POST /api/finance/invoices error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
