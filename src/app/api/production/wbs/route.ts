import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { stripWbsNotes } from '@/lib/wbs-parser'

export const dynamic = 'force-dynamic'

/**
 * GET /api/production/wbs?projectId=...
 * Đọc WBS đã import của dự án (từ task P1.2A — resultData.wbsItems JSON) để dựng lưới phát hành WO.
 * Trả về mảng hạng mục (WbsRow) + projectCode. WBS KHÔNG phải bảng — nó nằm trong Task.resultData.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const projectId = req.nextUrl.searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId', 400)

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true } })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)

    const planTask = await prisma.task.findFirst({
      where: { projectId, taskType: 'P1.2A' },
      select: { resultData: true },
      orderBy: { createdAt: 'desc' },
    })
    let rows: Record<string, string>[] = []
    if (planTask?.resultData) {
      const pData = planTask.resultData as Record<string, unknown>
      try {
        rows = typeof pData.wbsItems === 'string' ? JSON.parse(pData.wbsItems) : ((pData.wbsItems as Record<string, string>[]) || [])
      } catch { rows = [] }
    }
    rows = stripWbsNotes(rows) // bỏ ghi chú/chú giải/chữ ký (dữ liệu cũ có thể lưu kèm)

    // WO đã phát hành của dự án → FE đánh dấu ô đã có WO, và cần id để gắn đề nghị cấp vật tư.
    const pos = await prisma.workOrder.findMany({
      where: { projectId },
      select: { id: true, woCode: true },
    })
    const issuedWoCodes = pos.map(p => p.woCode)

    // Số dòng vật tư đã lập cho từng WO (hiện ngay trên nút "Vật tư"). Tách khỏi truy vấn trên và
    // bọc try/catch: nếu chưa chạy migration bảng work_order_material_requests thì CHỈ mất con số
    // này, WBS vẫn tải bình thường — không kéo sập cả màn phát hành WO.
    let matCount: Record<string, number> = {}
    try {
      const grouped = await prisma.workOrderMaterialRequest.groupBy({
        by: ['workOrderId'],
        where: { workOrderId: { in: pos.map(p => p.id) } },
        _count: { _all: true },
      })
      const byId = new Map(grouped.map(g => [g.workOrderId, g._count._all]))
      matCount = Object.fromEntries(pos.map(p => [p.woCode, byId.get(p.id) || 0]))
    } catch (e) {
      console.warn('[production/wbs] chưa đọc được đề nghị vật tư (migration?):', (e as Error).message)
      matCount = {}
    }
    const issuedWos = pos.map(p => ({ id: p.id, woCode: p.woCode, materialCount: matCount[p.woCode] || 0 }))

    return successResponse({ projectCode: project.projectCode, count: rows.length, rows, issuedWoCodes, issuedWos })
  } catch (err) {
    console.error('GET production/wbs error:', err)
    return errorResponse('Lỗi tải WBS dự án', 500)
  }
}
