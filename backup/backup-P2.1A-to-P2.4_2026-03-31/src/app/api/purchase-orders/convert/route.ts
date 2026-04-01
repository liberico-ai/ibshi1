import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'

// POST /api/purchase-orders/convert — Convert approved PR to PO
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!['R01', 'R02', 'R05', 'R07'].includes(user.roleCode)) {
      return errorResponse('Bạn không có quyền chuyển PR→PO', 403)
    }

    const body = await req.json()
    const { purchaseRequestId, vendorId, deliveryDate, notes } = body

    if (!purchaseRequestId) return errorResponse('Thiếu ID yêu cầu mua hàng')
    if (!vendorId) return errorResponse('Thiếu nhà cung cấp (vendorId)')

    const pr = await prisma.purchaseRequest.findUnique({
      where: { id: purchaseRequestId },
      include: { items: true },
    })

    if (!pr) return errorResponse('PR không tồn tại', 404)
    if (pr.status !== 'APPROVED') return errorResponse('PR chưa được duyệt, không thể chuyển thành PO')

    const poCount = await prisma.purchaseOrder.count()
    const poCode = `PO-${String(poCount + 1).padStart(5, '0')}`

    // PR items: materialId, quantity, specification. PO items add unitPrice.
    // Default unitPrice=0 if not provided (user edits PO later)
    const itemsData = pr.items.map(item => ({
      materialId: item.materialId,
      quantity: item.quantity,
      unitPrice: 0,
    }))

    const totalValue = 0 // Will be updated when PO items get priced

    const po = await prisma.purchaseOrder.create({
      data: {
        poCode,
        vendorId,
        status: 'DRAFT',
        totalValue,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        notes: notes || `Converted from ${pr.prCode}`,
        createdBy: user.userId,
        items: { create: itemsData },
      },
      include: { items: true },
    })

    await prisma.purchaseRequest.update({
      where: { id: purchaseRequestId },
      data: { status: 'CONVERTED' },
    })

    await logAudit(user.userId, 'CONVERT', 'PurchaseRequest→PurchaseOrder', po.id,
      { prCode: pr.prCode, poCode, itemCount: pr.items.length }, getClientIP(req))

    return successResponse({ purchaseOrder: po }, `Đã chuyển ${pr.prCode} → ${poCode}`, 201)
  } catch (err) {
    console.error('POST /api/purchase-orders/convert error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
