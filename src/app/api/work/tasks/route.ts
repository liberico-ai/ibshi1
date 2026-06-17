import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createTaskSchema } from '@/lib/schemas'
import { createTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks — tạo việc động + giao cho nhiều phòng/người
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const result = await validateBody(req, createTaskSchema)
    if (!result.success) return result.response
    const task = await createTask(result.data, payload.userId)
    await logAudit(payload.userId, 'CREATE', 'Task', task.id, { title: task.title }, getClientIP(req))
    return successResponse({ task }, 'Đã tạo & giao việc', 201)
  } catch (err) {
    console.error('POST /api/work/tasks error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 500)
  }
}
