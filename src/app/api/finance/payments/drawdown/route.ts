import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    return NextResponse.json({ ok: true, drawdowns: drawdownsWithSync })
  } catch (err: any) {
    console.error('Fetch Drawdowns error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { contractId, invoices, notes } = body 

    if (!contractId || !invoices || invoices.length === 0) {
      return NextResponse.json({ error: 'Missing required data: contractId or invoices' }, { status: 400 })
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
      const createdInvoices = []
      
      for (let i = 0; i < invoices.length; i++) {
        const invPayload = invoices[i]
        
        // Auto-spawn Advance Invoice
        const newInvoice = await tx.invoice.create({
          data: {
            invoiceCode: `INV-${invPayload.poCode || 'TAMP'}-${Math.floor(Math.random()*10000)}`,
            vendorId: invPayload.vendorId || defaultVendor.id,
            type: 'ADVANCE_PAYMENT',
            clientName: invPayload.vendorName,
            description: `Tạm ứng cho Đơn đặt hàng: ${invPayload.poCode}`,
            projectId: invPayload.projectId || null,
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
          createdBy: user.name || user.email || 'SYSTEM',
          
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

    return NextResponse.json({ ok: true, drawdown: result })

  } catch (err: any) {
    console.error('Create Drawdown error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
