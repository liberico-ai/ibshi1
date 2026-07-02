import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest, successResponse, errorResponse, unauthorizedResponse,
  forbiddenResponse, logAudit, getClientIP,
} from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createReceiptSchema } from '@/lib/schemas'
import { formatNumber } from '@/lib/utils'
import { FINANCE_WRITE_ROLES } from '@/lib/constants'

// ══════════════════════════════════════════════════════
//  Phiếu thu tiền khách hàng (CustomerReceipt) — Đợt 1C
//  - Chỉ dành cho hóa đơn RECEIVABLE (phải thu). Hóa đơn CHI vẫn đi qua /api/finance/payments.
//  - Invoice.paidAmount = Σ receipts (recompute từ DB trong transaction, KHÔNG +=)
//  - Mỗi receipt sinh đúng 1 CashflowEntry INFLOW (entryCode CF-RCP-<receiptId> — idempotent)
//  - Sửa sai duy nhất: DELETE /api/finance/receipts/[id] (chỉ R01)
// ══════════════════════════════════════════════════════

/** Lỗi nghiệp vụ ném từ trong transaction → map ra HTTP status. */
class ReceiptError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

// GET /api/finance/receipts?invoiceId= | ?projectId= — danh sách phiếu thu
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const invoiceId = searchParams.get('invoiceId')
    const projectId = searchParams.get('projectId')

    const where: Record<string, unknown> = {}
    if (invoiceId) where.invoiceId = invoiceId
    if (projectId) where.projectId = projectId

    const receipts = await prisma.customerReceipt.findMany({
      where,
      include: {
        invoice: { select: { invoiceCode: true, clientName: true, totalAmount: true, paidAmount: true } },
      },
      orderBy: { receivedAt: 'desc' },
    })

    return successResponse({
      receipts: receipts.map(r => ({
        ...r,
        amount: Number(r.amount),
        invoice: r.invoice ? {
          ...r.invoice,
          totalAmount: Number(r.invoice.totalAmount),
          paidAmount: Number(r.invoice.paidAmount),
        } : null,
      })),
      total: receipts.length,
    })
  } catch (err) {
    console.error('GET /api/finance/receipts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/finance/receipts — ghi nhận thu tiền khách cho hóa đơn RECEIVABLE
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(FINANCE_WRITE_ROLES as readonly string[]).includes(user.roleCode)) {
      return forbiddenResponse('Không có quyền ghi tài chính')
    }

    const result = await validateBody(req, createReceiptSchema)
    if (!result.success) return result.response
    const { invoiceId, amount, method, receivedAt, referenceNo, notes } = result.data
    const receivedDate = receivedAt ? new Date(receivedAt) : new Date()

    // (i) validate invoice + (ii) tạo receipt + (iii) recompute paidAmount + (iv) CashflowEntry — CÙNG transaction
    const receipt = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } })
      if (!invoice) throw new ReceiptError('Hóa đơn không tồn tại', 404)
      if (invoice.type !== 'RECEIVABLE') {
        throw new ReceiptError('Phiếu thu chỉ áp dụng cho hóa đơn phải thu (RECEIVABLE)', 422)
      }

      // Σ receipts hiện có — recompute từ DB, không tin invoice.paidAmount
      const agg = await tx.customerReceipt.aggregate({
        where: { invoiceId },
        _sum: { amount: true },
      })
      const collected = Number(agg._sum.amount || 0)
      const total = Number(invoice.totalAmount)
      if (collected + Number(amount) > total) {
        throw new ReceiptError(
          `Tổng thu vượt giá trị hóa đơn — còn lại ${formatNumber(total - collected)} VNĐ`, 409)
      }

      const r = await tx.customerReceipt.create({
        data: {
          invoiceId,
          projectId: invoice.projectId,
          amount: Number(amount),
          method: method || 'BANK',
          receivedAt: receivedDate,
          referenceNo: referenceNo || null,
          notes: notes || null,
          createdBy: user.userId,
        },
      })

      // (iii) paidAmount = Σ receipts (sau khi tạo) — recompute, không +=
      const newPaid = collected + Number(amount)
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaid, status: newPaid >= total ? 'PAID' : 'PARTIAL' },
      })

      // (iv) 1 receipt = đúng 1 CashflowEntry INFLOW (upsert theo entryCode → idempotent)
      await tx.cashflowEntry.upsert({
        where: { entryCode: `CF-RCP-${r.id}` },
        create: {
          entryCode: `CF-RCP-${r.id}`,
          type: 'INFLOW',
          category: 'CUSTOMER_RECEIPT',
          amount: Number(amount),
          description: `Thu tiền hóa đơn ${invoice.invoiceCode}`,
          entryDate: receivedDate,
          reference: r.id,
          projectId: invoice.projectId,
        },
        update: {},
      })

      return r
    })

    await logAudit(user.userId, 'RECEIPT_CREATE', 'CustomerReceipt', receipt.id,
      { invoiceId, amount: Number(amount), method, referenceNo }, getClientIP(req))

    return successResponse({ receipt: { ...receipt, amount: Number(receipt.amount) } }, 'Đã ghi nhận thu tiền')
  } catch (err) {
    if (err instanceof ReceiptError) return errorResponse(err.message, err.status)
    console.error('POST /api/finance/receipts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
