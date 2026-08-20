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
        status: true,
        vendors: { select: { id: true, vendorName: true, currency: true } },
        items: { select: { id: true, qtyToBuy: true, offers: { select: { vendorId: true, unitPrice: true, totalPrice: true, scope: true } } } },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)
    if (bid.status === 'CONTRACTED') return errorResponse('BID đã ký hợp đồng — không thể đổi lựa chọn NCC', 409)
    const vById = new Map(bid.vendors.map(v => [v.id, v]))

    // Tiền tệ của gói = loại phổ biến nhất trong các NCC (tránh so VND với USD).
    const curCount = new Map<string, number>()
    for (const v of bid.vendors) { const c = v.currency || 'VND'; curCount.set(c, (curCount.get(c) || 0) + 1) }
    const bidCurrency = [...curCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'VND'

    let updated = 0, skipped = 0, totalValue = 0
    await prisma.$transaction(async (tx) => {
      // Xoá hết lựa chọn cũ trước khi áp (giống Commerce).
      await tx.bidQuoteItem.updateMany({ where: { bidId: id }, data: { selectedVendorName: null } })
      for (const it of bid.items) {
        // Offer hợp lệ: NCC có CHÀO (scope='V') + đơn giá > 0 + CÙNG tiền tệ với gói.
        const eligible = it.offers.filter(o => (o.scope || 'V') === 'V' && Number(o.unitPrice) > 0 && (vById.get(o.vendorId)?.currency || 'VND') === bidCurrency)
        if (eligible.length === 0) { skipped++; continue }
        // Giá thấp nhất; hoà giá → tên NCC A→Z (xác định, tái lập được).
        eligible.sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice) || (vById.get(a.vendorId)?.vendorName || '').localeCompare(vById.get(b.vendorId)?.vendorName || ''))
        const win = eligible[0]
        const name = vById.get(win.vendorId)?.vendorName || null
        await tx.bidQuoteItem.update({ where: { id: it.id }, data: { selectedVendorName: name, selectedAt: new Date(), selectedBy: payload.userId } })
        updated++
        totalValue += Number(win.totalPrice) > 0 ? Number(win.totalPrice) : Number(win.unitPrice) * Number(it.qtyToBuy || 0)
      }
      await tx.bidAnalysis.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'EVALUATING' } })
    })
    return successResponse({ updated, skipped, bidCurrency, totalValue }, `Đã tự chọn NCC giá thấp nhất: ${updated} dòng${skipped ? `, bỏ qua ${skipped} dòng (không có báo giá hợp lệ cùng tiền tệ ${bidCurrency})` : ''}`)
  } catch (err) {
    console.error('POST auto-select-min-price error:', err)
    return errorResponse('Lỗi tự chọn giá thấp nhất', 500)
  }
}
