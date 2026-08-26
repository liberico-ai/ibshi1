import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v || 0)

/**
 * GET /api/procurement/dashboard-stats?projectId= — Bảng điều khiển mua sắm (khớp Commerce dashboard/stats).
 * Đếm nhanh theo từng chặng của quy trình + giá trị.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const projectId = req.nextUrl.searchParams.get('projectId') || undefined
    const prWhere = projectId ? { projectId } : {}
    const bidWhere = projectId ? { projectId } : {}
    const poWhere = projectId ? { projectId } : {}
    const ctWhere = projectId ? { projectId } : {}

    const [
      prPending, prApproved, prDraft,
      rfqOpen, rfqContracted,
      poPending, poApproved,
      ctDraft, ctActive, ctMtcPending,
      payPending, payApproved,
      aslApproved, openViolations,
      poValueAgg,
    ] = await Promise.all([
      prisma.purchaseRequest.count({ where: { ...prWhere, status: 'PENDING' } }),
      prisma.purchaseRequest.count({ where: { ...prWhere, status: 'APPROVED' } }),
      prisma.purchaseRequest.count({ where: { ...prWhere, status: 'DRAFT' } }),
      prisma.bidAnalysis.count({ where: { ...bidWhere, status: 'OPEN' } }),
      prisma.bidAnalysis.count({ where: { ...bidWhere, status: 'CONTRACTED' } }),
      prisma.purchaseOrder.count({ where: { ...poWhere, status: 'PENDING' } }),
      prisma.purchaseOrder.count({ where: { ...poWhere, status: { in: ['APPROVED', 'COMPLETED'] } } }),
      prisma.purchaseContract.count({ where: { ...ctWhere, status: 'DRAFT' } }),
      prisma.purchaseContract.count({ where: { ...ctWhere, status: 'ACTIVE' } }),
      prisma.purchaseContract.count({ where: { ...ctWhere, status: { not: 'CANCELLED' }, mtcStatus: 'PENDING' } }),
      prisma.paymentRequest.count({ where: { ...(projectId ? { projectId } : {}), status: 'PENDING' } }),
      prisma.paymentRequest.count({ where: { ...(projectId ? { projectId } : {}), status: 'APPROVED' } }),
      prisma.vendor.count({ where: { aslStatus: 'APPROVED' } }),
      prisma.supplierViolation.count({ where: { status: 'OPEN' } }),
      prisma.purchaseOrder.aggregate({ where: { ...poWhere, status: { notIn: ['CANCELLED', 'REJECTED'] } }, _sum: { totalValue: true } }),
    ])

    return successResponse({
      pr: { pending: prPending, approved: prApproved, draft: prDraft },
      rfq: { open: rfqOpen, contracted: rfqContracted },
      po: { pending: poPending, approved: poApproved, totalValue: N(poValueAgg._sum.totalValue) },
      contract: { draft: ctDraft, active: ctActive, mtcPending: ctMtcPending },
      payment: { pending: payPending, approved: payApproved },
      vendor: { aslApproved, openViolations },
    })
  } catch (err) {
    console.error('GET dashboard-stats error:', err)
    return errorResponse('Lỗi tải bảng điều khiển mua sắm', 500)
  }
}
