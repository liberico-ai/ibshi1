'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { fetchPoCoverageMap, computePrCoverage } from '@/lib/pr-coverage'

/**
 * GET /api/purchase-requests/[id]/coverage — độ phủ PO của 1 PR (P2-đợt2 B1)
 * Mọi role đăng nhập đều xem được (read-only).
 * Trả per-item {materialId, needed, covered, shortage} + summary {coveragePct, fullyCovered}.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const pr = await prisma.purchaseRequest.findUnique({
      where: { id },
      include: {
        items: { include: { material: { select: { materialCode: true, name: true, unit: true } } } },
      },
    })
    if (!pr) return errorResponse('Không tìm thấy yêu cầu mua hàng', 404)

    const poMap = await fetchPoCoverageMap(
      [pr.projectId],
      pr.items.map(i => i.materialId),
    )
    const { items, summary } = computePrCoverage(pr.projectId, pr.items, poMap)

    return successResponse({
      prId: pr.id,
      prCode: pr.prCode,
      status: pr.status,
      projectId: pr.projectId,
      items,
      summary,
    })
  } catch (err) {
    console.error('GET /api/purchase-requests/[id]/coverage error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
