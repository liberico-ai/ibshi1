import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validating roles if needed
    if (!['R01', 'R08', 'R08a', 'R10'].includes(user.roleCode)) {
      return NextResponse.json({ error: 'Chỉ Kế toán mới có quyền chốt giải ngân.' }, { status: 403 })
    }

    const { id } = await params
    
    const drawdown = await prisma.loanDrawdown.findUnique({
      where: { id },
      include: { beneficiaryLines: { include: { invoice: true } } }
    })
    
    if (!drawdown) return NextResponse.json({ error: 'Hồ sơ không tồn tại' }, { status: 404 })
    if (drawdown.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Hồ sơ phải ở trạng thái Đã phê duyệt mới có thể chốt giải ngân.' }, { status: 400 })
    }

    // Execute the drawdown -> Mark POs as PAID
    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.loanDrawdown.update({
        where: { id },
        data: { status: 'EXECUTED', executedBy: user.id || 'SYSTEM', executionDate: new Date() }
      })
      
      for (const line of drawdown.beneficiaryLines) {
        if (line.invoiceId) {
          // 1. Update Invoice to PAID
          const invoice = await tx.invoice.update({
            where: { id: line.invoiceId },
            data: { status: 'PAID', paidAmount: line.amountVnd, updatedAt: new Date() }
          })

          // 2. Extract PO from description and update PO
          const m = invoice.description?.match(/Đơn đặt hàng:\s*([^\s]+)/)
          if (m && m[1]) {
            const poCode = m[1].trim()
            const po = await tx.purchaseOrder.findUnique({ where: { poCode } })
            if (po) {
              await tx.purchaseOrder.update({
                where: { id: po.id },
                data: { status: 'PAID' }
              })
            }
          }
        }
      }
      return res
    })

    return NextResponse.json({ ok: true, drawdown: updated })
  } catch (err: any) {
    console.error('Execute Drawdown error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
