import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/bid-analyses?projectId=&status=
 * [PORT Thương Mại] Danh sách BID (RFQ/báo giá) — kèm #NCC + tổng giá trị.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const sp = new URL(req.url).searchParams
    const projectId = sp.get('projectId') || undefined
    const status = sp.get('status') || undefined

    const bids = await prisma.bidAnalysis.findMany({
      where: { ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) },
      select: {
        id: true, bidCode: true, subject: true, status: true, selectionMode: true,
        bidCodeMat: true, bidCodeUrgent: true, bidDate: true, createdAt: true,
        project: { select: { projectCode: true, projectName: true } },
        vendors: { select: { totalQuote: true } },
        _count: { select: { items: true, vendors: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const rows = bids.map(b => ({
      id: b.id, bidCode: b.bidCode, subject: b.subject, status: b.status, selectionMode: b.selectionMode,
      matGroup: b.bidCodeMat, urgent: b.bidCodeUrgent, bidDate: b.bidDate, createdAt: b.createdAt,
      projectCode: b.project?.projectCode || '', projectName: b.project?.projectName || '',
      itemCount: b._count.items, vendorCount: b._count.vendors,
      totalValue: b.vendors.reduce((s, v) => s + Number(v.totalQuote || 0), 0),
    }))
    return successResponse({ bids: rows })
  } catch (err) {
    console.error('GET /api/procurement/bid-analyses error:', err)
    return errorResponse('Lỗi tải danh sách BID', 500)
  }
}
