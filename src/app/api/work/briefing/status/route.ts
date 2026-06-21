import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
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
    const { taskId, status, blocked, reason, briefingPatch, deadline } = body as { taskId?: string; status?: string } & Partial<SetStatusAdminInput>

    if (!taskId) return errorResponse('Cần taskId', 400)
    if (!status && !briefingPatch) return errorResponse('Cần status hoặc briefingPatch', 400)

    let effectiveStatus = status
    if (!effectiveStatus) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } })
      if (!task) return errorResponse('Task không tìm thấy', 404)
      effectiveStatus = task.status
    }

    const result = await setTaskStatusAdmin(taskId, payload.userId, { status: effectiveStatus, blocked, reason, briefingPatch, deadline })
    return successResponse(result)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('không hợp lệ') || msg.includes('không tìm thấy')) return errorResponse(msg, 400)
    console.error('PATCH /api/work/briefing/status error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
