import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getProjectPrDemand } from '@/lib/data-fetchers'
import { enrichBomPrItems } from '@/lib/bompr-enrich'

export const dynamic = 'force-dynamic'

/**
 * GET /api/work/tasks/[id]/pr-demand
 * [PORT Thương Mại] Nhu cầu mua theo PR của dự án (nguồn PR-driven cho P3.5).
 * Trả về danh sách theo đúng shape "bomPr" mà SupplierQuoteUI đọc (stt/description/…/needToBuyQty),
 * đã enrich tồn kho (availableQty/needToBuyQty net) — khớp logic cột "Cần/Còn thiếu" của MCL.
 * Dùng khi task P3.5 chưa có bomPr trong resultData → client tự nạp để hiện đúng danh sách cần báo giá.
 * enrich chạy matchOnly (KHÔNG tạo mã vật tư tạm) — an toàn cho GET.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      select: { projectId: true, project: { select: { projectCode: true } } },
    })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)
    if (!task.projectId) return successResponse({ items: [] })

    const rows = await getProjectPrDemand(task.projectId)
    if (rows.length === 0) return successResponse({ items: [] })

    const prItems = rows.map(r => ({
      stt: r.itemCode,
      description: r.description,
      profile: r.profile,
      grade: r.grade,
      unit: r.unit,
      quantity: r.quantity,
      weight: 0, unitWeight: 0, thickness: 0, length: 0, width: 0,
      canonicalCode: r.itemCode || undefined,
    }))

    // Enrich tồn kho (matchOnly → không tạo mã tạm). Lỗi → giữ dữ liệu thô, không chặn.
    let enriched = prItems as Awaited<ReturnType<typeof enrichBomPrItems>>
    try {
      enriched = await enrichBomPrItems(prItems, task.project?.projectCode, { matchOnly: true })
    } catch (e) {
      console.error('[pr-demand] enrich skip — giữ dữ liệu thô:', e)
    }

    const items = enriched.map((e, i) => ({
      stt: e.stt,
      code: e.stt,
      description: e.description,
      profile: e.profile,
      grade: e.grade,
      unit: e.unit,
      quantity: e.quantity,
      neededQty: e.neededQty,
      availableQty: e.availableQty,
      needToBuyQty: e.needToBuyQty ?? rows[i]?.toBuyQty,
      canonicalCode: e.canonicalCode,
      materialGroupCode: rows[i]?.materialGroupCode ?? null,
    }))
    return successResponse({ items })
  } catch (err) {
    console.error('GET /api/work/tasks/[id]/pr-demand error:', err)
    return errorResponse('Lỗi tải nhu cầu PR', 500)
  }
}
