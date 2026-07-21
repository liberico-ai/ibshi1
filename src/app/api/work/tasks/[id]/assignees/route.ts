import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { reassignTaskSchema } from '@/lib/schemas'
import { editTaskAssignees } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// PATCH /api/work/tasks/[id]/assignees — RECALL: sửa/bỏ người nhận. CHỈ Quản trị hệ thống (R10).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (payload.roleCode !== 'R10') return forbiddenResponse('Chỉ Quản trị hệ thống được sửa người nhận')
    const { id } = await params
    const result = await validateBody(req, reassignTaskSchema)
    if (!result.success) return result.response
    const r = await editTaskAssignees(id, payload.userId, payload.roleCode, result.data.assignees)
    return successResponse(r, 'Đã cập nhật người nhận')
  } catch (err) {
    console.error('PATCH /api/work/tasks/[id]/assignees error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 500)
  }
}
