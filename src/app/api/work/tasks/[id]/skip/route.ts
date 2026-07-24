import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { skipTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

const skipSchema = z.object({ skipReason: z.string().min(1, 'Cần nhập lý do bỏ qua') })

// POST /api/work/tasks/[id]/skip — "Không ảnh hưởng — Bỏ qua" checkpoint round≥1 (Revise Flow36)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, skipSchema)
    if (!result.success) return result.response
    const r = await skipTask(id, payload.userId, result.data.skipReason)
    await logAudit(payload.userId, 'SKIP_NO_IMPACT', 'Task', id, { skipReason: result.data.skipReason }, getClientIP(req))
    return successResponse(r, 'Đã bỏ qua (không ảnh hưởng)')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/skip error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
