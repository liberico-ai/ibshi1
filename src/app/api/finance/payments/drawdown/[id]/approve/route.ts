import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Segregation of Duties Check: Only Head of Accounting or Admin can approve
    // assuming R01 = admin, R02 = Kế toán trưởng
    if (!['R01', 'R08', 'R08a', 'R10'].includes(user.roleCode)) {
      return NextResponse.json({ error: 'Chỉ Kế toán trưởng mới có quyền phê duyệt hồ sơ giải ngân.' }, { status: 403 })
    }

    const { id } = await params
    
    // Check if exists
    const drawdown = await prisma.loanDrawdown.findUnique({
      where: { id },
      include: { beneficiaryLines: true }
    })
    
    if (!drawdown) return NextResponse.json({ error: 'Hồ sơ không tồn tại' }, { status: 404 })
    if (drawdown.status !== 'PENDING_APPROVAL') {
      return NextResponse.json({ error: 'Hồ sơ không ở trạng thái hợp lệ để duyệt' }, { status: 400 })
    }

    // Approve the drawdown
    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.loanDrawdown.update({
        where: { id },
        data: { status: 'APPROVED' }
      })
      
      // Update invoices to APPROVED as well (or keep PROCESSING until disbursed)
      for (const line of drawdown.beneficiaryLines) {
        if (line.invoiceId) {
          await tx.invoice.update({
            where: { id: line.invoiceId },
            data: { status: 'APPROVED' }
          })
        }
      }
      return res
    })

    return NextResponse.json({ ok: true, drawdown: updated })
  } catch (err: any) {
    console.error('Approve Drawdown error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
