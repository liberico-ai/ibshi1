import { isMissingTableError, MIGRATION_HINT } from '@/lib/db-missing-table'
import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { buildWoMaterialLines } from '@/lib/wo-materials'

// Danh sách PHIẾU CẤP VẬT TƯ THEO LỆNH SẢN XUẤT cho màn Kho.
// Mỗi WO = 1 phiếu (khác luồng cũ: mỗi DÒNG vật tư một việc P4.5 riêng, Kho không biết của LSX nào).
// Mặc định chỉ lấy WO chưa cấp xong; ?all=1 để xem cả phiếu đã cấp đủ.
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId') || undefined
    const includeDone = url.searchParams.get('all') === '1'

    const workOrders = await prisma.workOrder.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        materialRequests: { some: { request: { status: "APPROVED" } } }, // chỉ WO có phiếu ĐÃ DUYỆT
      },
      select: {
        id: true, woCode: true, description: true, status: true, teamCode: true,
        pieceMark: true, plannedStart: true, plannedEnd: true,
        project: { select: { projectCode: true, projectName: true } },
      },
      orderBy: [{ status: 'asc' }, { plannedStart: 'asc' }],
      take: 200,
    })

    const items = []
    for (const wo of workOrders) {
      const lines = await buildWoMaterialLines(wo.id)
      const fulfilled = lines.length > 0 && lines.every((l) => l.issued >= l.requested)
      if (fulfilled && !includeDone) continue
      items.push({
        ...wo,
        lines,
        totalLines: lines.length,
        pendingLines: lines.filter((l) => l.remaining > 0).length,
        fulfilled,
      })
    }

    return successResponse({ items, count: items.length })
  } catch (err) {
    console.error('GET /api/production/material-issue error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
