import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v ?? 0)

/**
 * GET /api/procurement/purchase-history?itemCodes=A,B  (hoặc itemCode=A)
 * [PORT Thương Mại — F3] Lịch sử mua theo itemCode + phân tích vendor/giá (bám getPurchaseHistory).
 * Nguồn ibshi1: PurchaseOrderItem + PurchaseOrder.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const raw = req.nextUrl.searchParams.get('itemCodes') || req.nextUrl.searchParams.get('itemCode') || ''
    const itemCodes = raw.split(',').map(s => s.trim()).filter(Boolean)
    if (itemCodes.length === 0) return errorResponse('Thiếu itemCodes', 400)
    if (itemCodes.length > 50) return errorResponse('Tối đa 50 mã VT mỗi lần', 400)

    const items = await prisma.purchaseOrderItem.findMany({
      where: { itemCode: { in: itemCodes } },
      orderBy: { purchaseOrder: { orderDate: 'desc' } },
      select: {
        id: true, itemCode: true, description: true, profile: true, grade: true, unit: true, quantity: true, unitPrice: true, receivedQty: true,
        purchaseOrder: { select: { poCode: true, orderDate: true, currency: true, status: true, vendor: { select: { name: true } }, project: { select: { projectCode: true, projectName: true } } } },
      },
    })

    const byCode = new Map<string, { itemCode: string; itemName: string; profile: string; grade: string; uom: string; transactions: Array<Record<string, unknown>> }>()
    for (const it of items) {
      const code = it.itemCode || ''
      if (!code) continue
      if (!byCode.has(code)) byCode.set(code, { itemCode: code, itemName: it.description || '', profile: it.profile || '', grade: it.grade || '', uom: it.unit || '', transactions: [] })
      byCode.get(code)!.transactions.push({
        id: it.id, poCode: it.purchaseOrder.poCode, vendorName: it.purchaseOrder.vendor?.name || 'Không rõ',
        orderDate: it.purchaseOrder.orderDate, qty: N(it.quantity), unitPrice: N(it.unitPrice), currency: it.purchaseOrder.currency,
        totalNoVAT: N(it.quantity) * N(it.unitPrice), status: it.purchaseOrder.status, receivedQty: N(it.receivedQty),
        projectCode: it.purchaseOrder.project?.projectCode || '', projectName: it.purchaseOrder.project?.projectName || '',
      })
    }

    const data = [...byCode.values()].map(item => {
      const txs = item.transactions
      const vendorMap = new Map<string, { vendorName: string; txCount: number; totalQty: number; totalValue: number; prices: number[] }>()
      for (const t of txs) {
        const vn = t.vendorName as string
        const v = vendorMap.get(vn) ?? { vendorName: vn, txCount: 0, totalQty: 0, totalValue: 0, prices: [] }
        v.txCount += 1; v.totalQty += t.qty as number; v.totalValue += t.totalNoVAT as number
        if ((t.unitPrice as number) > 0) v.prices.push(t.unitPrice as number)
        vendorMap.set(vn, v)
      }
      const vendorSummary = [...vendorMap.values()].map(v => ({
        vendorName: v.vendorName, txCount: v.txCount, totalQty: v.totalQty, totalValue: v.totalValue,
        avgPrice: v.prices.length ? v.prices.reduce((a, b) => a + b, 0) / v.prices.length : 0,
        minPrice: v.prices.length ? Math.min(...v.prices) : 0, maxPrice: v.prices.length ? Math.max(...v.prices) : 0,
      })).sort((a, b) => b.totalQty - a.totalQty)
      const prices = txs.filter(t => (t.unitPrice as number) > 0).map(t => t.unitPrice as number)
      return {
        ...item,
        summary: {
          totalTransactions: txs.length, totalVendors: vendorMap.size,
          totalQtyBought: txs.reduce((s, t) => s + (t.qty as number), 0), totalValueNoVAT: txs.reduce((s, t) => s + (t.totalNoVAT as number), 0),
          avgUnitPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
          minUnitPrice: prices.length ? Math.min(...prices) : 0, maxUnitPrice: prices.length ? Math.max(...prices) : 0,
          latestVendor: (txs[0]?.vendorName as string) || null, latestPrice: (txs[0]?.unitPrice as number) || null, latestDate: txs[0]?.orderDate || null,
        },
        vendorSummary,
      }
    })

    return successResponse({ data, notFound: itemCodes.filter(c => !byCode.has(c)), total: data.length })
  } catch (err) {
    console.error('GET purchase-history error:', err)
    return errorResponse('Lỗi tải lịch sử mua hàng', 500)
  }
}
