import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/purchase-requests/[id]/revisions — #5: xem lại các lần rev của PR (khớp Commerce).
 * Trả revNo hiện tại + danh sách snapshot các phiên bản trước (mỗi lần task nguồn đổi → 1 rev).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params

    const pr = await prisma.purchaseRequest.findUnique({
      where: { id },
      select: {
        id: true, prCode: true, docNo: true, revNo: true, status: true, updatedAt: true,
        _count: { select: { items: true } },
        revisions: {
          orderBy: { revNo: 'desc' },
          select: { id: true, revNo: true, lineCount: true, note: true, changedBy: true, changedAt: true, itemsSnapshot: true },
        },
      },
    })
    if (!pr) return errorResponse('Không tìm thấy PR', 404)

    return successResponse({
      prCode: pr.prCode, docNo: pr.docNo, currentRev: pr.revNo, status: pr.status,
      currentLineCount: pr._count.items, updatedAt: pr.updatedAt,
      revisions: pr.revisions.map(r => ({
        revNo: r.revNo, lineCount: r.lineCount, note: r.note, changedBy: r.changedBy, changedAt: r.changedAt,
        // tóm tắt vài dòng để xem nhanh (tránh trả toàn bộ snapshot lớn)
        sampleItems: Array.isArray(r.itemsSnapshot)
          ? (r.itemsSnapshot as Array<Record<string, unknown>>).slice(0, 50).map(it => ({
              itemCode: it.itemCode ?? null, description: it.description ?? null,
              quantity: it.quantity ?? it.reqQty ?? null, unit: it.unit ?? null,
            }))
          : [],
      })),
    })
  } catch (err) {
    console.error('GET pr revisions error:', err)
    return errorResponse('Lỗi tải lịch sử rev PR', 500)
  }
}
