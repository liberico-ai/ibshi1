import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { reviseRoundView, bulkSkipRound } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/revise?projectId=..&round=N — xem 1 vòng revise (subgraph + checkpoint + hint)
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId')
    const round = Number(url.searchParams.get('round'))
    if (!projectId || !Number.isInteger(round) || round < 1) return errorResponse('Thiếu projectId hoặc round ≥ 1', 400)
    const view = await reviseRoundView(projectId, round)
    return successResponse({ view })
  } catch (err) {
    console.error('GET /api/work/revise error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}

const bulkSkipSchema = z.object({
  projectId: z.string().min(1),
  round: z.number().int().min(1),
  codes: z.array(z.string().min(1)).min(1, 'Chọn ít nhất 1 bước'),
  reason: z.string().min(1, 'Cần nhập lý do bỏ qua'),
})

// POST /api/work/revise — bỏ qua hàng loạt cụm impact-clean (bước 'affected' bị từ chối)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const result = await validateBody(req, bulkSkipSchema)
    if (!result.success) return result.response
    const { projectId, round, codes, reason } = result.data
    const r = await bulkSkipRound(projectId, round, codes, reason, payload.userId)
    await logAudit(payload.userId, 'BULK_SKIP_REVISE', 'Project', projectId, { round, skipped: r.skipped, refused: r.refused }, getClientIP(req))
    return successResponse(r, `Đã bỏ qua ${r.skipped.length} bước${r.refused.length ? `, ${r.refused.length} bước "có ảnh hưởng" cần xử lý riêng` : ''}`)
  } catch (err) {
    console.error('POST /api/work/revise error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
