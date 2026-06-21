import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { setTaskStatusAdmin, type SetStatusAdminInput } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

export async function PATCH(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được cập nhật trạng thái')

    const body = await req.json()
    const { taskId, status, blocked, reason, briefingPatch, deadline } = body as { taskId?: string } & SetStatusAdminInput

    if (!taskId || !status) return errorResponse('Cần taskId và status', 400)

    const result = await setTaskStatusAdmin(taskId, payload.userId, { status, blocked, reason, briefingPatch, deadline })
    return successResponse(result)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('không hợp lệ') || msg.includes('không tìm thấy')) return errorResponse(msg, 400)
    console.error('PATCH /api/work/briefing/status error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
