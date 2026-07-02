import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const FINANCE_ROLES = ['R01', 'R02', 'R02a', 'R08', 'R08a', 'R10']
    if (!FINANCE_ROLES.includes(user.roleCode)) {
      return errorResponse('Forbidden. Chỉ bộ phận Tài chính mới có quyền truy cập.', 403)
    }

    // Build the query to get all drawdowns with relations
    const drawdowns = await prisma.loanDrawdown.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        contract: {
          include: { facility: true, project: true }
        },
        beneficiaryLines: {
          include: { invoice: true, vendor: true }
        },
        }
    })

    // Check Misa Sync Status
    const syncLogs = await prisma.cashflowEntry.findMany({
      where: { status: 'MISA_SYNCED' },
      select: { reference: true }
    })
    const syncedRefs = new Set(syncLogs.map(s => s.reference))

    const drawdownsWithSync = drawdowns.map(dd => ({
      ...dd,
      misaSynced: syncedRefs.has(dd.drawdownNo)
    }))

    return successResponse({ drawdowns: drawdownsWithSync })
  } catch (err) {
    console.error('Fetch Drawdowns error:', err)
    return errorResponse('Lỗi máy chủ nội bộ', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const FINANCE_ROLES = ['R01', 'R08', 'R08a', 'R10']
    if (!FINANCE_ROLES.includes(user.roleCode)) {
      return errorResponse('Forbidden. Chỉ Kế toán mới có quyền tạo hồ sơ giải ngân.', 403)
    }

    const body = await req.json()
    const { contractId, invoices, notes } = body 

    if (!contractId || !invoices || invoices.length === 0) {
      return errorResponse('Missing required data: contractId or invoices', 400)
    }

    // PO-Gate: chỉ lập hồ sơ giải ngân/tạm ứng cho PO đã được duyệt (APPROVED trở đi).
    // invoices[].id là PO id (xem CreateDrawdownForm) — PO PENDING/DRAFT/REJECTED/CANCELLED → 422.
    const linkedPoIds: string[] = invoices.map((inv: { id?: string }) => inv.id).filter(Boolean)
    // PO ids thật sự tồn tại — dùng để set Invoice.poId (FK) khi tạo hóa đơn tạm ứng bên dưới
    const existingPoIds = new Set<string>()
    if (linkedPoIds.length > 0) {
      const linkedPos = await prisma.purchaseOrder.findMany({
        where: { id: { in: linkedPoIds } },
        select: { id: true, poCode: true, status: true },
      })
      for (const po of linkedPos) existingPoIds.add(po.id)
      const notApproved = linkedPos.filter(po => ['PENDING', 'DRAFT', 'REJECTED', 'CANCELLED'].includes(po.status))
      if (notApproved.length > 0) {
        return errorResponse(
          `PO chưa được duyệt: ${notApproved.map(po => `${po.poCode} (${po.status})`).join(', ')} — cần R01/R07 duyệt PO trước khi giải ngân`,
          422
        )
      }
    }

    const totalAmount = invoices.reduce((sum: number, inv: any) => sum + Number(inv.totalAmount || 0), 0)

    const drawdownNo = `DD-${new Date().toISOString().slice(0,10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`

    // Generate drawdown and its beneficiary lines
    const result = await prisma.$transaction(async (tx) => {
      // 1. Ensure mock VPBank Facility & Contract exist for demo purposes
      let contract = await tx.loanContract.findUnique({ where: { contractCode: 'HDV-VPBANK-01' } })
      if (!contract) {
        const facility = await tx.creditFacility.upsert({
          where: { facilityCode: 'VPB-01' },
          update: {},
          create: { facilityCode: 'VPB-01', bankName: 'VPBank', creditLimit: 10000000000, startDate: new Date(), endDate: new Date(Date.now() + 31536000000) }
        })
        contract = await tx.loanContract.create({
          data: { id: contractId, contractCode: 'HDV-VPBANK-01', facilityId: facility.id, loanAmount: 5000000000, interestRate: 6.5, termMonths: 6, signDate: new Date() }
        })
      }

      // 2. Ensure default Vendor exists if invoice is missing it
      const defaultVendor = await tx.vendor.upsert({
        where: { vendorCode: 'VND-DEFAULT' },
        update: {},
        create: { 
          vendorCode: 'VND-DEFAULT', 
          name: 'Đối tác Tạm ứng / Mặc định', 
          category: 'OTHER'
        }
      })

      // Create Invoices on the fly for these PO Advance Payments and create Beneficiary Lines
      const createdInvoices: any[] = []
      
      for (let i = 0; i < invoices.length; i++) {
        const invPayload = invoices[i]
        
        // DEPRECATED: legacy WorkflowTask, đã ngừng dùng
        // P3.6 projectId lookup was here but workflowTask table is dead — use invoice projectId only.
        const foundProjectId = invPayload.projectId || null;

        // Auto-spawn Advance Invoice
        // invPayload.id là PO id (xem CreateDrawdownForm) → gắn FK Invoice.poId
        // để sync-engine loại hóa đơn này khỏi SERVICE actual (chống double-count với GRN).
        const newInvoice = await tx.invoice.create({
          data: {
            invoiceCode: `INV-${invPayload.poCode || 'TAMP'}-${Math.floor(Math.random()*10000)}`,
            vendorId: invPayload.vendorId || defaultVendor.id,
            poId: invPayload.id && existingPoIds.has(invPayload.id) ? invPayload.id : null,
            type: 'ADVANCE_PAYMENT',
            clientName: invPayload.vendorName,
            description: `Tạm ứng cho Đơn đặt hàng: ${invPayload.poCode}`,
            projectId: foundProjectId,
            amount: Number(invPayload.totalAmount || 0),
            taxRate: 0,
            taxAmount: 0,
            totalAmount: Number(invPayload.totalAmount || 0),
            status: 'PROCESSING'
          }
        })
        createdInvoices.push(newInvoice)
        
        // Also update the PurchaseOrder status to PROCESSING_PAYMENT so it doesn't show up again
        await tx.purchaseOrder.update({
          where: { id: invPayload.id },
          data: { status: 'PROCESSING_PAYMENT' }
        })
      }

      const drawdown = await tx.loanDrawdown.create({
        data: {
          drawdownNo,
          contractId,
          amountFundedVnd: totalAmount,
          requestDate: new Date(),
          status: 'PENDING_APPROVAL',
          createdBy: user.fullName || user.username || 'SYSTEM',
          
          beneficiaryLines: {
            create: invoices.map((inv: any, i: number) => ({
              sequenceNo: i + 1,
              vendorId: inv.vendorId || defaultVendor.id,
              invoiceId: createdInvoices[i].id, // Link to newly created Invoice!
              invoiceNumber: createdInvoices[i].invoiceCode,
              amountVnd: Number(inv.totalAmount || 0),
              bankName: inv.bankName || 'N/A',
              bankAccountNo: inv.bankAccount || 'N/A',
            }))
          }
        },
        include: { beneficiaryLines: true }
      })


      return drawdown
    })

    return successResponse({ drawdown: result })

  } catch (err) {
    console.error('Create Drawdown error:', err)
    return errorResponse('Lỗi máy chủ nội bộ', 500)
  }
}
