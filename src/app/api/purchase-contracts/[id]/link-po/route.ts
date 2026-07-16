import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  logAudit,
  getClientIP,
} from '@/lib/auth'
import { CONTRACT_WRITE_ROLES } from '@/lib/purchase-contract-constants'

// T1 — POST /api/purchase-contracts/[id]/link-po — gắn PO vào HĐ (set PurchaseOrder.contractId)
// Body: { poId: string, unlink?: boolean }
// - unlink=true → gỡ PO khỏi HĐ (chỉ gỡ nếu PO đang thuộc đúng HĐ này)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!CONTRACT_WRITE_ROLES.has(user.roleCode)) {
      return forbiddenResponse('Chỉ Thương mại (R07) / BGĐ (R01) được gắn PO vào hợp đồng')
    }

    const { id: contractId } = await params
    if (!contractId) return errorResponse('Thiếu mã hợp đồng', 400)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return errorResponse('Dữ liệu không hợp lệ', 400)

    const poId = String(body.poId || '').trim()
    const unlink = body.unlink === true
    if (!poId) return errorResponse('Thiếu mã PO (poId)', 400)

    const contract = await prisma.purchaseContract.findUnique({
      where: { id: contractId },
      select: { id: true, projectId: true, vendorId: true },
    })
    if (!contract) return errorResponse('Hợp đồng không tồn tại', 404)

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, poCode: true, projectId: true, vendorId: true, contractId: true },
    })
    if (!po) return errorResponse('Đơn đặt hàng không tồn tại', 404)

    // ── Gỡ liên kết ──
    if (unlink) {
      if (po.contractId !== contractId) {
        return errorResponse('PO này không thuộc hợp đồng đang thao tác', 400)
      }
      const updated = await prisma.purchaseOrder.update({ where: { id: poId }, data: { contractId: null } })
      await logAudit(user.userId, 'UNLINK_PO', 'PurchaseContract', contractId, { poId, poCode: po.poCode }, getClientIP(req))
      return successResponse({ purchaseOrder: { id: updated.id, contractId: updated.contractId } }, 'Đã gỡ PO khỏi hợp đồng')
    }

    // ── Gắn liên kết ──
    // PO đã gắn HĐ khác → chặn (tránh gắn nhầm, phải gỡ trước)
    if (po.contractId && po.contractId !== contractId) {
      return errorResponse('PO này đã thuộc một hợp đồng khác. Gỡ liên kết cũ trước khi gắn mới.', 409)
    }
    // PO và HĐ phải cùng nhà cung cấp (HĐ ký với 1 NCC)
    if (po.vendorId !== contract.vendorId) {
      return errorResponse('PO và hợp đồng phải cùng nhà cung cấp', 400)
    }
    // Nếu PO có dự án, phải khớp dự án của HĐ (khi HĐ gắn dự án)
    if (contract.projectId && po.projectId && po.projectId !== contract.projectId) {
      return errorResponse('PO và hợp đồng phải cùng dự án', 400)
    }

    const updated = await prisma.purchaseOrder.update({ where: { id: poId }, data: { contractId } })
    await logAudit(user.userId, 'LINK_PO', 'PurchaseContract', contractId, { poId, poCode: po.poCode }, getClientIP(req))

    return successResponse({ purchaseOrder: { id: updated.id, contractId: updated.contractId } }, 'Đã gắn PO vào hợp đồng')
  } catch (err) {
    console.error('POST /api/purchase-contracts/[id]/link-po error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
