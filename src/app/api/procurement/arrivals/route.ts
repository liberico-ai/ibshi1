import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v || 0)

/**
 * GET /api/procurement/arrivals?projectId=&stage= — Màn "Hàng về & QC" (khớp Commerce).
 * Liệt kê hợp đồng theo giai đoạn nhận hàng: chờ về → hàng về → mời QC → nghiệm thu → nhập kho.
 * Kèm trạng thái MTC + số phiếu nhận hàng. Trả stats theo giai đoạn.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const projectId = req.nextUrl.searchParams.get('projectId') || undefined

    const contracts = await prisma.purchaseContract.findMany({
      where: { status: { not: 'CANCELLED' }, ...(projectId ? { projectId } : {}) },
      orderBy: { arrivedDate: 'desc' },
      take: 500,
      select: {
        id: true, contractCode: true, tradeType: true, arrivedDate: true, qcInvitationDate: true, mtcStatus: true,
        importLcDate: true, cifDate: true, customsDate: true,
        vendor: { select: { name: true } }, project: { select: { projectCode: true } },
        items: { select: { id: true, itemCode: true, description: true, contractQty: true, deliveredQty: true, inspections: { select: { result: true, acceptedQty: true } } } },
        _count: { select: { goodsReceipts: true } },
      },
    })

    const rows = contracts.map(c => {
      const totalQty = c.items.reduce((s, it) => s + N(it.contractQty), 0)
      const deliveredQty = c.items.reduce((s, it) => s + N(it.deliveredQty), 0)
      const inspected = c.items.filter(it => it.inspections.length > 0).length
      const passed = c.items.filter(it => it.inspections.some(q => /pass|đạt/i.test(q.result || ''))).length
      const hasReceipt = c._count.goodsReceipts > 0
      // Giai đoạn.
      let stage = 'waiting'
      if (inspected > 0 && inspected >= c.items.length && c.items.length > 0) stage = 'accepted'
      else if (c.qcInvitationDate) stage = 'qc'
      else if (hasReceipt || (deliveredQty > 0 && deliveredQty >= totalQty * 0.5)) stage = 'arrived'
      else if (c.arrivedDate) stage = 'arrived'
      return {
        id: c.id, contractCode: c.contractCode, tradeType: c.tradeType, vendorName: c.vendor?.name || '',
        projectCode: c.project?.projectCode || null, arrivedDate: c.arrivedDate, qcInvitationDate: c.qcInvitationDate,
        mtcStatus: c.mtcStatus, receiptCount: c._count.goodsReceipts,
        itemCount: c.items.length, inspectedCount: inspected, passedCount: passed,
        deliveredPct: totalQty > 0 ? Math.round((deliveredQty / totalQty) * 100) : 0,
        logistics: { lcDate: c.importLcDate, cifDate: c.cifDate, customsDate: c.customsDate },
        stage,
      }
    })
    const cnt = (s: string) => rows.filter(r => r.stage === s).length
    const stats = { total: rows.length, waiting: cnt('waiting'), arrived: cnt('arrived'), qc: cnt('qc'), accepted: cnt('accepted') }
    return successResponse({ rows, stats })
  } catch (err) {
    console.error('GET arrivals error:', err)
    return errorResponse('Lỗi tải Hàng về & QC', 500)
  }
}
