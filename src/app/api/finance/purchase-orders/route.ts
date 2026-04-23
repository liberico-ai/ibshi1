import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch PurchaseOrders that are APPROVED and not yet fully PAID
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        status: 'APPROVED'
      },
      include: {
        vendor: true
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ ok: true, purchaseOrders: pos })
  } catch (err: any) {
    console.error('Fetch POs error:', err)
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 })
  }
}
