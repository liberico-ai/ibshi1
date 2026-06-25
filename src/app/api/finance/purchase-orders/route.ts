import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R08', 'R08a', 'R10']
    if (!ALLOWED_ROLES.includes(user.roleCode)) {
      return errorResponse('Forbidden', 403)
    }

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

    return successResponse({ purchaseOrders: pos })
  } catch (err: any) {
    console.error('Fetch POs error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
