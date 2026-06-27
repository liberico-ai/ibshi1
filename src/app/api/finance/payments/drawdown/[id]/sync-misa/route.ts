import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const { id } = await params
    
    const drawdown = await prisma.loanDrawdown.findUnique({
      where: { id },
      include: { beneficiaryLines: true }
    })

    if (!drawdown) return errorResponse('Hồ sơ không tồn tại', 404)

    // Check if already synced
    const existing = await prisma.cashflowEntry.findFirst({
      where: { reference: drawdown.drawdownNo, status: 'MISA_SYNCED' }
    })

    if (existing) {
      return errorResponse('Hồ sơ này đã được đồng bộ với Misa SME trước đó', 400)
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

        // DEPRECATED: legacy WorkflowTask, đã ngừng dùng
        // P3.6 projectId fallback was here but workflowTask table is dead — projectId stays null if invoice lacks it.
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

    return successResponse({ synced: true })

  } catch (error: any) {
    console.error('Misa Sync Error:', error)
    return errorResponse('Lỗi hệ thống khi đồng bộ Misa', 500)
  }
}
