import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { setTaskStatusAdmin, type SetStatusAdminInput } from '@/lib/work-engine'
import { notifyExecEscalation } from '@/lib/telegram-notifications'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

export async function PATCH(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được cập nhật trạng thái')

    const body = await req.json()
    const { taskId, status, blocked, escalated, execReviewed, reason, briefingPatch, deadline } = body as { taskId?: string; status?: string; escalated?: boolean; execReviewed?: boolean } & Partial<SetStatusAdminInput>

    if (!taskId) return errorResponse('Cần taskId', 400)
    if (!status && !briefingPatch && escalated === undefined && execReviewed === undefined) return errorResponse('Cần status, briefingPatch, escalated, hoặc execReviewed', 400)

    let effectiveStatus = status
    if (!effectiveStatus) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } })
      if (!task) return errorResponse('Task không tìm thấy', 404)
      effectiveStatus = task.status
    }

    const result = await setTaskStatusAdmin(taskId, payload.userId, { status: effectiveStatus, blocked, escalated, execReviewed, reason, briefingPatch, deadline })

    if (result.wasEscalated) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { title: true, blocked: true, deadline: true, project: { select: { projectCode: true, projectName: true } }, assignees: true },
      })
      if (task) {
        const uids = task.assignees.map(a => a.userId).filter(Boolean) as string[]
        const users = uids.length ? await prisma.user.findMany({ where: { id: { in: uids } }, select: { fullName: true } }) : []
        const assigneeName = users.map(u => u.fullName).join(', ') || '—'
        const daysOverdue = task.deadline ? Math.ceil((Date.now() - new Date(task.deadline).getTime()) / 86400000) : 0
        const reasonText = task.blocked ? 'Tắc' : daysOverdue > 0 ? `Quá hạn ${daysOverdue}d` : 'PM đẩy'
        notifyExecEscalation({
          projectCode: task.project?.projectCode || '—',
          projectName: task.project?.projectName || '',
          title: task.title,
          assigneeName,
          reason: reasonText,
          byName: payload.fullName || payload.username || 'PM',
          taskId,
          daysOverdue: daysOverdue > 0 ? daysOverdue : undefined,
        }).catch(() => {})
      }
    }

    return successResponse(result)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('không hợp lệ') || msg.includes('không tìm thấy')) return errorResponse(msg, 400)
    console.error('PATCH /api/work/briefing/status error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
