import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { reassignTaskSchema } from '@/lib/schemas'
import { reassignTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/reassign — giao tiếp cho phòng/người khác
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, reassignTaskSchema)
    if (!result.success) return result.response
    const r = await reassignTask(id, payload.userId, result.data)
    return successResponse(r, 'Đã giao lại công việc')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/reassign error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 500)
  }
}
