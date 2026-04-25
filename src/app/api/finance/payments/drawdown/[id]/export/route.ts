import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    
    const drawdown = await prisma.loanDrawdown.findUnique({
      where: { id },
      include: { beneficiaryLines: { include: { vendor: true } } }
    })
    
    if (!drawdown) return NextResponse.json({ error: 'Hồ sơ không tồn tại' }, { status: 404 })
    if (drawdown.status !== 'APPROVED' && drawdown.status !== 'DISBURSED') {
      return NextResponse.json({ error: 'Hồ sơ phải được phê duyệt trước khi export' }, { status: 400 })
    }

    // Removed exportStatus update as it's not in schema
    const vpbankData = drawdown.beneficiaryLines.map((line, index) => ({
      'STT': index + 1,
      'Tài khoản trích nợ': '', // To be filled by user or system param
      'Tên người thụ hưởng': line.vendor?.name || 'N/A',
      'Số tài khoản thụ hưởng': line.bankAccountNo,
      'Ngân hàng thụ hưởng': line.bankName,
      'Số tiền': Number(line.amountVnd),
      'Diễn giải': `Thanh toán hồ sơ ${drawdown.drawdownNo}`,
    }))

    return NextResponse.json({ ok: true, data: vpbankData, filename: `VPBank_Export_${drawdown.drawdownNo}.xlsx` })
  } catch (err: any) {
    console.error('Export Drawdown error:', err)
    return NextResponse.json({ error: 'Lỗi hệ thống khi export giải ngân' }, { status: 500 })
  }
}
