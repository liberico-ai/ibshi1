import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { requestRedo } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

const redoSchema = z.object({ reason: z.string().min(1, 'Cần nhập lý do làm lại') })

// POST /api/work/tasks/[id]/request-redo — người tạo đánh giá không đạt → đẩy về người nhận làm lại
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, redoSchema)
    if (!result.success) return result.response
    const r = await requestRedo(id, payload.userId, result.data.reason)
    await logAudit(payload.userId, 'REQUEST_REDO', 'Task', id, { reason: result.data.reason }, getClientIP(req))
    return successResponse(r, 'Đã yêu cầu làm lại')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/request-redo error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
