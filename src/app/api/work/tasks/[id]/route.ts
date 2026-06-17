import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateTaskSchema } from '@/lib/schemas'
import { getTaskDetail, updateTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/tasks/[id] — chi tiết task + assignees + docs + subtask + history
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const task = await getTaskDetail(id)
    if (!task) return errorResponse('Không tìm thấy công việc', 404)
    return successResponse({ task })
  } catch (err) {
    console.error('GET /api/work/tasks/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PATCH /api/work/tasks/[id] — người tạo sửa việc (tiêu đề/mô tả/deadline/ưu tiên)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, updateTaskSchema)
    if (!result.success) return result.response
    await updateTask(id, payload.userId, result.data)
    return successResponse({}, 'Đã cập nhật công việc')
  } catch (err) {
    console.error('PATCH /api/work/tasks/[id] error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
