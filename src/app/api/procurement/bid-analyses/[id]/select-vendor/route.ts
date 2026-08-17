import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * POST /api/procurement/bid-analyses/[id]/select-vendor  body: { vendorId }
 * [PORT Thương Mại] Mode PER_BID: chọn 1 NCC cho TOÀN BỘ dòng → set selectedVendorName tất cả dòng
 * = NCC đó, đánh isWinner, BidAnalysis.selectedVendorId + status SELECTED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { vendorId?: string }
    if (!body.vendorId) return errorResponse('Thiếu vendorId', 400)

    const ba = await prisma.bidAnalysis.findUnique({ where: { id }, select: { status: true } })
    if (!ba) return errorResponse('Không tìm thấy BID', 404)
    if (ba.status === 'CONTRACTED') return errorResponse('BID đã ký hợp đồng — không thể đổi lựa chọn NCC', 409)

    const vendor = await prisma.bidQuoteVendor.findFirst({
      where: { id: body.vendorId, bidId: id }, select: { id: true, vendorName: true },
    })
    if (!vendor) return errorResponse('NCC không thuộc BID này', 404)

    await prisma.$transaction(async (tx) => {
      await tx.bidQuoteVendor.updateMany({ where: { bidId: id }, data: { isWinner: false } })
      await tx.bidQuoteVendor.update({ where: { id: vendor.id }, data: { isWinner: true } })
      await tx.bidQuoteItem.updateMany({ where: { bidId: id }, data: { selectedVendorName: vendor.vendorName } })
      await tx.bidAnalysis.update({ where: { id }, data: { selectedVendorId: vendor.id, status: 'SELECTED' } })
    })
    return successResponse({ vendorName: vendor.vendorName }, `Đã chọn ${vendor.vendorName} cho toàn bộ BID`)
  } catch (err) {
    console.error('POST select-vendor (per-bid) error:', err)
    return errorResponse('Lỗi chọn NCC', 500)
  }
}
