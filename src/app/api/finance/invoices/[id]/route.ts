import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest, successResponse, errorResponse, unauthorizedResponse,
  forbiddenResponse, logAudit, getClientIP,
} from '@/lib/auth'
import { recalcBudgetActual } from '@/lib/sync-engine'

// DELETE /api/finance/invoices/[id] — chỉ R01 (BGĐ): đường sửa sai DUY NHẤT cho hóa đơn tạo nhầm.
// CHẶN xóa khi hóa đơn đã có tiền/chứng từ gắn vào (paidAmount > 0, phiếu thu, thanh toán,
// dòng giải ngân) — các trường hợp đó phải gỡ chứng từ trước. Xóa xong recompute Budget.actual.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (user.roleCode !== 'R01') {
      return forbiddenResponse('Chỉ BGĐ (R01) mới được xóa hóa đơn')
    }

    const { id } = await params
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        _count: { select: { receipts: true, payments: true, drawdownLines: true } },
      },
    })
    if (!invoice) return errorResponse('Hóa đơn không tồn tại', 404)

    // Chặn xóa khi đã có tiền/chứng từ gắn vào — nêu rõ lý do để người dùng gỡ trước
    const reasons: string[] = []
    if (Number(invoice.paidAmount) > 0) {
      reasons.push(`đã thanh toán ${Number(invoice.paidAmount).toLocaleString()}₫ (paidAmount > 0)`)
    }
    if (invoice._count.receipts > 0) {
      reasons.push(`có ${invoice._count.receipts} phiếu thu (CustomerReceipt) gắn hóa đơn`)
    }
    if (invoice._count.payments > 0) {
      reasons.push(`có ${invoice._count.payments} thanh toán (Payment) gắn hóa đơn`)
    }
    if (invoice._count.drawdownLines > 0) {
      reasons.push(`có ${invoice._count.drawdownLines} dòng giải ngân (Drawdown) gắn hóa đơn`)
    }
    if (reasons.length > 0) {
      return errorResponse(`Không thể xóa hóa đơn ${invoice.invoiceCode}: ${reasons.join('; ')}. Gỡ chứng từ liên quan trước khi xóa.`, 409)
    }

    await prisma.invoice.delete({ where: { id } })

    // Hóa đơn CHI ảnh hưởng SERVICE actual → recompute (nguồn duy nhất: recalcBudgetActual)
    if (invoice.projectId) {
      try { await recalcBudgetActual(invoice.projectId, user.userId) }
      catch (e) { console.error('[DELETE invoice] recalcBudgetActual error:', e) }
    }

    await logAudit(user.userId, 'INVOICE_DELETE', 'Invoice', id,
      {
        invoiceCode: invoice.invoiceCode, type: invoice.type,
        totalAmount: Number(invoice.totalAmount), projectId: invoice.projectId,
      },
      getClientIP(req))

    return successResponse({ deleted: true }, `Đã xóa hóa đơn ${invoice.invoiceCode}`)
  } catch (err) {
    console.error('DELETE /api/finance/invoices/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
