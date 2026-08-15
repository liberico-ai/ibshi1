import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/bid-analyses/[id]/approval-summary
 * [PORT Thương Mại] Tổng hợp phê duyệt: gom dòng theo NCC đã chọn (selectedVendorName),
 * dùng đơn giá của chính NCC đó cho dòng đó. Trả summary + byVendor[].
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params

    const bid = await prisma.bidAnalysis.findUnique({
      where: { id },
      select: {
        id: true,
        vendors: { select: { id: true, vendorName: true, currency: true } },
        items: {
          orderBy: { itemOrder: 'asc' },
          select: {
            id: true, itemCode: true, itemName: true, profile: true, grade: true, uom: true,
            qtyToBuy: true, selectedVendorName: true,
            offers: { select: { vendorId: true, unitPrice: true, totalPrice: true } },
          },
        },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)

    const vendorIdByName = new Map(bid.vendors.map(v => [v.vendorName.toLowerCase(), v.id]))
    const groups = new Map<string, { vendorName: string; itemCount: number; totalValue: number; items: unknown[] }>()
    let assignedItems = 0
    let totalApprovedValue = 0

    for (const it of bid.items) {
      if (!it.selectedVendorName) continue
      assignedItems++
      const vId = vendorIdByName.get(it.selectedVendorName.toLowerCase())
      const offer = vId ? it.offers.find(o => o.vendorId === vId) : undefined
      const unitPrice = Number(offer?.unitPrice || 0)
      const totalPrice = Number(offer?.totalPrice || 0)
      totalApprovedValue += totalPrice
      const key = it.selectedVendorName
      if (!groups.has(key)) groups.set(key, { vendorName: key, itemCount: 0, totalValue: 0, items: [] })
      const g = groups.get(key)!
      g.itemCount++
      g.totalValue += totalPrice
      g.items.push({
        itemCode: it.itemCode, itemName: it.itemName, profile: it.profile, grade: it.grade,
        qtyToBuy: Number(it.qtyToBuy || 0), uom: it.uom, unitPrice, totalPrice,
      })
    }

    return successResponse({
      summary: {
        totalItems: bid.items.length, assignedItems, pendingItems: bid.items.length - assignedItems,
        totalApprovedValue, vendorCount: groups.size,
      },
      byVendor: [...groups.values()],
    })
  } catch (err) {
    console.error('GET approval-summary error:', err)
    return errorResponse('Lỗi tổng hợp duyệt', 500)
  }
}
