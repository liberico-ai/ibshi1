import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * PATCH /api/procurement/bid-analyses/[id]/items/[itemId]/select-vendor
 * body: { vendorName: string | null }
 * [PORT Thương Mại] Chọn NCC cho TỪNG DÒNG (mode PER_ITEM) — set BidQuoteItem.selectedVendorName.
 * null = bỏ chọn. BID chuyển EVALUATING nếu đang OPEN.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền duyệt NCC', 403)
    const { id, itemId } = await params
    const body = await req.json().catch(() => ({})) as { vendorName?: string | null }
    const vendorName = body.vendorName ? String(body.vendorName).trim() : null

    const ba = await prisma.bidAnalysis.findUnique({ where: { id }, select: { status: true } })
    if (!ba) return errorResponse('Không tìm thấy BID', 404)
    if (ba.status === 'CONTRACTED') return errorResponse('BID đã ký hợp đồng — không thể đổi lựa chọn NCC', 409)

    const item = await prisma.bidQuoteItem.findFirst({ where: { id: itemId, bidId: id }, select: { id: true } })
    if (!item) return errorResponse('Dòng không thuộc BID này', 404)

    await prisma.bidQuoteItem.update({ where: { id: itemId }, data: { selectedVendorName: vendorName } })
    await prisma.bidAnalysis.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'EVALUATING' } })
    return successResponse({ itemId, selectedVendorName: vendorName })
  } catch (err) {
    console.error('PATCH select-vendor error:', err)
    return errorResponse('Lỗi chọn NCC', 500)
  }
}
