import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { applyTemplate } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

const applySchema = z.object({
  projectId: z.string().min(1),
  templateCode: z.string().min(1),
  // Áp GIỮA FLOW: bắt đầu sinh việc từ bước này (các bước tổ tiên đánh dấu DONE-bỏ-qua).
  // Bỏ trống = áp từ đầu (P1.1) như cũ.
  fromStepCode: z.string().min(1).optional(),
})
const ALLOWED = ['R01', 'R02', 'R02a', 'R10', 'R00']

// POST /api/work/templates/apply — áp template vào dự án (auto-sinh task)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED.includes(payload.roleCode)) return forbiddenResponse('Bạn không có quyền áp template')
    const result = await validateBody(req, applySchema)
    if (!result.success) return result.response
    const r = await applyTemplate(result.data.projectId, result.data.templateCode, payload.userId, {
      fromStepCode: result.data.fromStepCode,
    })
    await logAudit(payload.userId, 'APPLY_TEMPLATE', 'Project', result.data.projectId, { templateCode: result.data.templateCode, fromStepCode: result.data.fromStepCode, created: r.created, skipped: r.skipped }, getClientIP(req))
    return successResponse(r, `Đã sinh ${r.created} công việc${r.skipped ? `, bỏ qua ${r.skipped} bước trước` : ''} từ "${r.template}"`)
  } catch (err) {
    console.error('POST /api/work/templates/apply error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
