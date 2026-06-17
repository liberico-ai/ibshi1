import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { returnTaskSchema } from '@/lib/schemas'
import { returnTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/return — Trả lại (sai phạm vi)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, returnTaskSchema)
    if (!result.success) return result.response
    const r = await returnTask(id, payload.userId, payload.roleCode, result.data.reason)
    await logAudit(payload.userId, 'RETURN', 'Task', id, { reason: result.data.reason }, getClientIP(req))
    return successResponse(r, 'Đã trả lại công việc')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/return error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
