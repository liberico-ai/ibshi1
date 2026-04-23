import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    
    const drawdown = await prisma.loanDrawdown.findUnique({
      where: { id },
      include: { beneficiaryLines: true }
    })

    if (!drawdown) return NextResponse.json({ error: 'Hồ sơ không tồn tại' }, { status: 404 })

    // Check if already synced
    const existing = await prisma.cashflowEntry.findFirst({
      where: { reference: drawdown.drawdownNo, status: 'MISA_SYNCED' }
    })

    if (existing) {
      return NextResponse.json({ error: 'Hồ sơ này đã được đồng bộ với Misa SME trước đó' }, { status: 400 })
    }

    // Fetch contract to get projectId safely outside nested includes
    const contract = await prisma.loanContract.findUnique({ where: { id: drawdown.contractId } });
    let projectId: string | null = contract?.primaryProjectId || null;

    if (!projectId && drawdown.beneficiaryLines.length > 0) {
      // Fetch invoices safely
      const invoiceIds = drawdown.beneficiaryLines.map(l => l.invoiceId).filter(Boolean) as string[];
      if (invoiceIds.length > 0) {
        const firstInvoice = await prisma.invoice.findFirst({ where: { id: invoiceIds[0] } });
        projectId = firstInvoice?.projectId || null;
      }
    }

    // In a real app we would call Misa API here
    // Example: await fetch('https://amis.misa.vn/api/v1/accounting/expense', { ... })
    
    // Since this is ERP mock, we simulate success and insert the locally reconciled CashflowEntry
    await prisma.cashflowEntry.create({
      data: {
        entryCode: `UNC-${new Date().toISOString().slice(2,10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`,
        type: 'OUTFLOW',
        category: 'MATERIAL_COST', 
        amount: drawdown.amountFundedVnd,
        description: `Thanh toán hồ sơ giải ngân ${drawdown.drawdownNo}`,
        entryDate: new Date(),
        reference: drawdown.drawdownNo,
        status: 'MISA_SYNCED',
        projectId
      }
    })

    return NextResponse.json({ ok: true, synced: true })

  } catch (error: any) {
    console.error('Misa Sync Error:', error)
    return NextResponse.json({ error: error.message || 'Lỗi hệ thống' }, { status: 500 })
  }
}
