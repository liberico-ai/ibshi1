import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v ?? 0)

/**
 * GET /api/procurement/purchase-history/summary?itemCode=<single>
 * [PORT Thương Mại — F3] Tóm tắt nhanh lịch sử mua 1 SKU cho panel trượt (bám getPurchaseHistorySummary).
 * ibshi1: nguồn = PurchaseOrderItem + PurchaseOrder (poCode/ngày/NCC/giá) thay ContractDetail của Commerce.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const itemCode = req.nextUrl.searchParams.get('itemCode')
    if (!itemCode) return errorResponse('Thiếu itemCode', 400)

    const items = await prisma.purchaseOrderItem.findMany({
      where: { itemCode },
      orderBy: { purchaseOrder: { orderDate: 'desc' } },
      take: 20,
      select: {
        id: true, description: true, unit: true, quantity: true, unitPrice: true, receivedQty: true,
        purchaseOrder: { select: { poCode: true, orderDate: true, currency: true, status: true, vendor: { select: { name: true } }, project: { select: { projectCode: true } } } },
      },
    })

    if (items.length === 0) return successResponse({ itemCode, found: false, summary: null, recentTransactions: [], vendorSummary: [] })

    const txs = items.map(it => ({
      id: it.id, poCode: it.purchaseOrder.poCode, vendorName: it.purchaseOrder.vendor?.name || 'Không rõ',
      orderDate: it.purchaseOrder.orderDate, qty: N(it.quantity), unitPrice: N(it.unitPrice), currency: it.purchaseOrder.currency,
      totalNoVAT: N(it.quantity) * N(it.unitPrice), status: it.purchaseOrder.status, projectCode: it.purchaseOrder.project?.projectCode || '', receivedQty: N(it.receivedQty),
    }))

    const vendorMap = new Map<string, { vendorName: string; txCount: number; totalQty: number; latestPrice: number; latestDate: Date | null }>()
    for (const t of txs) {
      const v = vendorMap.get(t.vendorName) ?? { vendorName: t.vendorName, txCount: 0, totalQty: 0, latestPrice: 0, latestDate: null }
      v.txCount += 1; v.totalQty += t.qty
      if (!v.latestDate || (t.orderDate && t.orderDate > v.latestDate)) { v.latestDate = t.orderDate; v.latestPrice = t.unitPrice }
      vendorMap.set(t.vendorName, v)
    }
    const prices = txs.filter(t => t.unitPrice > 0).map(t => t.unitPrice)
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0

    return successResponse({
      itemCode, found: true, itemName: items[0].description || '', uom: items[0].unit || '',
      summary: {
        totalTransactions: txs.length, totalVendors: vendorMap.size,
        avgUnitPrice: avg, minUnitPrice: prices.length ? Math.min(...prices) : 0, maxUnitPrice: prices.length ? Math.max(...prices) : 0,
        latestVendor: txs[0]?.vendorName || null, latestPrice: txs[0]?.unitPrice || null, latestDate: txs[0]?.orderDate || null,
      },
      recentTransactions: txs.slice(0, 10),
      vendorSummary: [...vendorMap.values()].sort((a, b) => b.totalQty - a.totalQty).slice(0, 5),
    })
  } catch (err) {
    console.error('GET purchase-history summary error:', err)
    return errorResponse('Lỗi tải lịch sử mua hàng', 500)
  }
}
