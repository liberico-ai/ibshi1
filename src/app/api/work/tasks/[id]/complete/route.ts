import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { completeWorkTaskSchema } from '@/lib/schemas'
import { completeTask } from '@/lib/work-engine'
import { materializePrSafe } from '@/lib/pr-materialize'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/complete — Hoàn thành (= phê duyệt)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, completeWorkTaskSchema)
    if (!result.success) return result.response
    await completeTask(id, payload.userId, payload.roleCode, result.data)
    // Sinh/cập nhật PR (sau FF_PR_MATERIALIZE, mặc định TẮT). Không bao giờ throw.
    await materializePrSafe(id, payload.userId)
    await logAudit(payload.userId, 'COMPLETE', 'Task', id, {}, getClientIP(req))
    return successResponse({}, 'Đã hoàn thành công việc')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/complete error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
