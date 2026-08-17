import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']
const MODES = ['PER_BID', 'PER_ITEM', 'PER_GROUP', 'AUTO_MIN_PRICE', 'MANUAL_WEIGHTED']

/** PATCH /api/procurement/bid-analyses/[id]/selection-mode  body: { selectionMode } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { selectionMode?: string }
    if (!body.selectionMode || !MODES.includes(body.selectionMode)) return errorResponse('selectionMode không hợp lệ', 400)

    const ba = await prisma.bidAnalysis.findUnique({ where: { id }, select: { status: true, selectionMode: true } })
    if (!ba) return errorResponse('Không tìm thấy BID', 404)
    if (ba.status === 'CONTRACTED') return errorResponse('BID đã ký hợp đồng — không thể đổi chế độ chọn', 409)
    // Không đổi gì nếu cùng mode — tránh xóa oan lựa chọn hiện có.
    if (ba.selectionMode === body.selectionMode) return successResponse({ selectionMode: body.selectionMode })

    // Đổi mode → RESET lựa chọn của mode cũ (tránh rác chồng mode: vd PER_BID→PER_ITEM còn sót selectedVendorName).
    await prisma.$transaction(async (tx) => {
      await tx.bidQuoteItem.updateMany({ where: { bidId: id }, data: { selectedVendorName: null } })
      await tx.bidQuoteVendor.updateMany({ where: { bidId: id }, data: { isWinner: false } })
      await tx.bidAnalysis.update({
        where: { id },
        data: { selectionMode: body.selectionMode, selectedVendorId: null, status: ba.status === 'SELECTED' ? 'EVALUATING' : ba.status },
      })
    })
    return successResponse({ selectionMode: body.selectionMode }, 'Đã đổi chế độ và xóa lựa chọn cũ')
  } catch (err) {
    console.error('PATCH selection-mode error:', err)
    return errorResponse('Lỗi đổi chế độ', 500)
  }
}
