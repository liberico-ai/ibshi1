import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'

export const dynamic = 'force-dynamic'
// Nhận hàng: Kho (R05) + Thương mại (R07) + BGĐ/Admin.
const CAN = ['R01', 'R05', 'R05a', 'R07', 'R07a', 'R10']

// Cộng N ngày làm việc (bỏ T7/CN) — QT25 §3.6: phiếu nhận hàng ≤ 5 ngày làm việc kể từ khi hàng đến.
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from); let added = 0
  while (added < days) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) added++ }
  return d
}

// GET — danh sách phiếu nhận hàng của HĐ.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const rows = await prisma.goodsReceipt.findMany({ where: { contractId: id }, orderBy: { receivedDate: 'desc' } })
    return successResponse({ receipts: rows })
  } catch (err) {
    console.error('GET goods-receipt error:', err)
    return errorResponse('Lỗi tải phiếu nhận hàng', 500)
  }
}

// POST — tạo phiếu nhận hàng (QT25) với checklist 6 bước + SLA.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền lập phiếu nhận hàng', 403)
    const { id } = await params
    const b = await req.json().catch(() => ({})) as {
      packingChecked?: boolean; qtyChecked?: boolean; hasDamage?: boolean; damageHold?: boolean; damageNote?: string
      tagged?: boolean; notifiedProd?: boolean; note?: string; arrivedDate?: string
    }
    const contract = await prisma.purchaseContract.findUnique({ where: { id }, select: { id: true, contractCode: true, projectId: true, arrivedDate: true, vendor: { select: { name: true } } } })
    if (!contract) return errorResponse('Không tìm thấy hợp đồng', 404)

    const arrived = b.arrivedDate ? new Date(b.arrivedDate) : (contract.arrivedDate || null)
    const now = new Date()
    const slaDeadline = arrived ? addBusinessDays(arrived, 5) : null
    const withinSla = slaDeadline ? now <= slaDeadline : null
    const count = await prisma.goodsReceipt.count()
    const code = `PNH-${now.getFullYear().toString().slice(2)}-${String(count + 1).padStart(4, '0')}`

    const gr = await prisma.goodsReceipt.create({
      data: {
        code, contractId: id, projectId: contract.projectId, vendorName: contract.vendor?.name || null,
        arrivedDate: arrived, receivedDate: now, receivedBy: user.userId,
        packingChecked: !!b.packingChecked, qtyChecked: !!b.qtyChecked,
        hasDamage: !!b.hasDamage, damageHold: !!b.damageHold, damageNote: b.damageNote || null,
        tagged: !!b.tagged, notifiedProd: !!b.notifiedProd,
        slaDeadline, withinSla, status: 'COMPLETED', note: b.note || null,
      },
      select: { id: true, code: true, withinSla: true },
    })
    // Đồng bộ ngày hàng về lên HĐ nếu chưa có.
    if (arrived && !contract.arrivedDate) await prisma.purchaseContract.update({ where: { id }, data: { arrivedDate: arrived } })
    await logAudit(user.userId, 'GOODS_RECEIPT_CREATE', 'PurchaseContract', id, { contractCode: contract.contractCode, code: gr.code, withinSla, damageHold: !!b.damageHold }, getClientIP(req))
    return successResponse({ id: gr.id, code: gr.code, withinSla: gr.withinSla }, `Đã lập phiếu nhận hàng ${gr.code}${withinSla === false ? ' (⚠ TRỄ hạn 5 ngày làm việc)' : ''}`)
  } catch (err) {
    console.error('POST goods-receipt error:', err)
    return errorResponse('Lỗi lập phiếu nhận hàng', 500)
  }
}
