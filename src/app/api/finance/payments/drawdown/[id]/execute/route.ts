import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { recalcBudgetActual, recordDrawdownCashflow } from '@/lib/sync-engine'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    // Validating roles if needed
    if (!['R01', 'R08', 'R08a', 'R10'].includes(user.roleCode)) {
      return errorResponse('Chỉ Kế toán mới có quyền chốt giải ngân.', 403)
    }

    const { id } = await params
    
    const drawdown = await prisma.loanDrawdown.findUnique({
      where: { id },
      include: { beneficiaryLines: { include: { invoice: true } } }
    })
    
    if (!drawdown) return errorResponse('Hồ sơ không tồn tại', 404)
    if (drawdown.status !== 'APPROVED') {
      return errorResponse('Hồ sơ phải ở trạng thái Đã phê duyệt mới có thể chốt giải ngân.', 400)
    }

    // Xác định dự án của hồ sơ giải ngân: khế ước → dự án chính, fallback invoice đầu tiên có projectId
    const contract = await prisma.loanContract.findUnique({ where: { id: drawdown.contractId } })
    let projectId: string | null = contract?.primaryProjectId || null
    if (!projectId) {
      projectId = drawdown.beneficiaryLines.find(l => l.invoice?.projectId)?.invoice?.projectId || null
    }

    // Execute the drawdown -> Mark POs as PAID
    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.loanDrawdown.update({
        where: { id },
        data: { status: 'EXECUTED', executedBy: user.userId || 'SYSTEM', executionDate: new Date() }
      })

      // Ghi dòng tiền CHI (OUTFLOW) cho giải ngân — CÙNG transaction, idempotent theo drawdown.id
      await recordDrawdownCashflow(tx, drawdown, projectId)


      for (const line of drawdown.beneficiaryLines) {
        if (line.invoiceId) {
          // 1. Update Invoice to PAID
          const invoice = await tx.invoice.update({
            where: { id: line.invoiceId },
            data: { status: 'PAID', paidAmount: line.amountVnd, updatedAt: new Date() }
          })

          // 2. Extract PO/PR Code from description and update PO & Procurement Tracking status
          const m = invoice.description?.match(/Đơn đặt hàng:\s*([^\s]+)/)
          if (m && m[1]) {
            const poCode = m[1].trim()
            
            // Update physical PO if exists
            const po = await tx.purchaseOrder.findUnique({ where: { poCode } })
            if (po) {
              await tx.purchaseOrder.update({
                where: { id: po.id },
                data: { status: 'PAID' }
              })
            }
            
            // DEPRECATED: legacy WorkflowTask, đã ngừng dùng
            // P3.6 procurement tracking status update was here but workflowTask table is dead — removed.
          }
        }
      }
      return res
    })

    // Thực chi ảnh hưởng chi phí thực tế → recompute actual (nguồn duy nhất: recalcBudgetActual)
    if (projectId) {
      try { await recalcBudgetActual(projectId, user.userId) }
      catch (e) { console.error('[Drawdown execute] recalcBudgetActual error:', e) }
    }

    return successResponse({ drawdown: updated })
  } catch (err) {
    console.error('Execute Drawdown error:', err)
    return errorResponse('Lỗi máy chủ nội bộ', 500)
  }
}
