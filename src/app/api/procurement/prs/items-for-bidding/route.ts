import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/prs/items-for-bidding?projectId=
 * [PORT Thương Mại] PR item của dự án CHƯA đưa vào BID nào (để tạo RFQ).
 * Lọc: PR không CANCELLED/REJECTED + item chưa gắn bid_quote_items.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined
    if (!projectId) return errorResponse('Thiếu projectId', 400)

    const items = await prisma.purchaseRequestItem.findMany({
      where: {
        bidQuoteItems: { none: {} }, // chưa vào BID nào
        purchaseRequest: { projectId, status: { notIn: ['CANCELLED', 'REJECTED'] } },
      },
      select: {
        id: true, itemCode: true, description: true, profile: true, grade: true, unit: true,
        quantity: true, toBuyQty: true, materialGroupCode: true, statusFlag: true,
        material: { select: { materialCode: true, name: true, unit: true } },
        purchaseRequest: { select: { prCode: true } },
      },
      orderBy: { itemCode: 'asc' },
    })

    const rows = items.map(it => ({
      id: it.id,
      itemCode: it.itemCode || it.material?.materialCode || '',
      itemName: it.description || it.material?.name || '',
      profile: it.profile || '',
      grade: it.grade || '',
      uom: it.unit || it.material?.unit || '',
      reqQty: Number(it.quantity) || 0,
      // toBuyQty=0 (PR cũ chưa auto-fill) → dùng quantity làm SL cần mua
      toBuyQty: Number(it.toBuyQty) > 0 ? Number(it.toBuyQty) : Number(it.quantity) || 0,
      materialGroupCode: it.materialGroupCode || null,
      statusFlag: it.statusFlag || 'Chờ báo giá',
      prCode: it.purchaseRequest?.prCode || '',
    }))
    return successResponse({ items: rows })
  } catch (err) {
    console.error('GET /api/procurement/prs/items-for-bidding error:', err)
    return errorResponse('Lỗi tải PR item', 500)
  }
}
