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

    // Danh sách woCode đã phát hành của dự án → FE đánh dấu ô đã có WO.
    const pos = await prisma.workOrder.findMany({ where: { projectId }, select: { woCode: true } })
    const issuedWoCodes = pos.map(p => p.woCode)

    return successResponse({ projectCode: project.projectCode, count: rows.length, rows, issuedWoCodes })
  } catch (err) {
    console.error('GET production/wbs error:', err)
    return errorResponse('Lỗi tải WBS dự án', 500)
  }
}
