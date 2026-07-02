import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest, successResponse, errorResponse, unauthorizedResponse,
  forbiddenResponse, logAudit, getClientIP,
} from '@/lib/auth'

// DELETE /api/finance/receipts/[id] — chỉ R01 (BGĐ): đường sửa sai DUY NHẤT cho phiếu thu.
// Xóa receipt + xóa CashflowEntry tương ứng + recompute Invoice.paidAmount — cùng transaction.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (user.roleCode !== 'R01') {
      return forbiddenResponse('Chỉ BGĐ (R01) mới được xóa phiếu thu')
    }

    const { id } = await params
    const receipt = await prisma.customerReceipt.findUnique({ where: { id } })
    if (!receipt) return errorResponse('Phiếu thu không tồn tại', 404)

    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: receipt.invoiceId } })

      await tx.customerReceipt.delete({ where: { id } })

      // Xóa đúng CashflowEntry sinh từ receipt này (entryCode CF-RCP-<id>)
      await tx.cashflowEntry.deleteMany({ where: { entryCode: `CF-RCP-${id}` } })

      // Recompute paidAmount = Σ receipts còn lại (không -=)
      const agg = await tx.customerReceipt.aggregate({
        where: { invoiceId: receipt.invoiceId },
        _sum: { amount: true },
      })
      const newPaid = Number(agg._sum.amount || 0)

      if (invoice) {
        const total = Number(invoice.totalAmount)
        // Trạng thái: PAID/PARTIAL theo số đã thu; về 0 thì trả về SENT (chỉ khi đang PAID/PARTIAL)
        const newStatus = newPaid >= total && total > 0
          ? 'PAID'
          : newPaid > 0
            ? 'PARTIAL'
            : (['PAID', 'PARTIAL'].includes(invoice.status) ? 'SENT' : invoice.status)
        await tx.invoice.update({
          where: { id: receipt.invoiceId },
          data: { paidAmount: newPaid, status: newStatus },
        })
      }
    })

    await logAudit(user.userId, 'RECEIPT_DELETE', 'CustomerReceipt', id,
      { invoiceId: receipt.invoiceId, amount: Number(receipt.amount), referenceNo: receipt.referenceNo },
      getClientIP(req))

    return successResponse({ deleted: true }, 'Đã xóa phiếu thu và tính lại số đã thu')
  } catch (err) {
    console.error('DELETE /api/finance/receipts/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
