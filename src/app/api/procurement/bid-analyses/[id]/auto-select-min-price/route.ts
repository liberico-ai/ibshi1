import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * POST /api/procurement/bid-analyses/[id]/auto-select-min-price
 * [PORT Thương Mại] Mỗi dòng tự chọn NCC có ĐƠN GIÁ thấp nhất (>0). Dòng không NCC nào báo → bỏ trống.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params

    const bid = await prisma.bidAnalysis.findUnique({
      where: { id },
      select: {
        vendors: { select: { id: true, vendorName: true } },
        items: { select: { id: true, offers: { select: { vendorId: true, unitPrice: true } } } },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)
    const nameById = new Map(bid.vendors.map(v => [v.id, v.vendorName]))

    let picked = 0
    await prisma.$transaction(async (tx) => {
      for (const it of bid.items) {
        const priced = it.offers.filter(o => Number(o.unitPrice) > 0)
        if (priced.length === 0) continue
        const min = priced.reduce((a, b) => Number(b.unitPrice) < Number(a.unitPrice) ? b : a)
        const name = nameById.get(min.vendorId) || null
        await tx.bidQuoteItem.update({ where: { id: it.id }, data: { selectedVendorName: name } })
        picked++
      }
      await tx.bidAnalysis.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'EVALUATING' } })
    })
    return successResponse({ picked }, `Đã tự chọn NCC giá thấp nhất cho ${picked} dòng`)
  } catch (err) {
    console.error('POST auto-select-min-price error:', err)
    return errorResponse('Lỗi tự chọn giá thấp nhất', 500)
  }
}
