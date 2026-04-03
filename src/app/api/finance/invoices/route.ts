import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
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
      return NextResponse.json({ ok: false, error: 'Không có quyền' }, { status: 403 })
    }

    const body = await req.json()
    const { invoiceCode, projectId, vendorId, type, clientName, description, amount, taxRate, dueDate } = body

    if (!invoiceCode || !type || !amount) return errorResponse('Thiếu thông tin', 400)

    const numAmount = Number(amount)
    const numTaxRate = Number(taxRate || 10)
    const taxAmount = numAmount * numTaxRate / 100
    const totalAmount = numAmount + taxAmount

    const invoice = await prisma.invoice.create({
      data: {
        invoiceCode, projectId: projectId || null, vendorId: vendorId || null,
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
