import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { BRIEFING_WRITE_ROLES } from '@/lib/constants'
import { setTaskStatusAdmin, type SetStatusAdminInput } from '@/lib/work-engine'
import { notifyExecEscalation } from '@/lib/telegram-notifications'
import { taskDaysOverdue } from '@/lib/utils'
import { sendDirectMessage } from '@/lib/telegram'
import { ROLE_TO_DEPT, DEPT_PRIMARY_ROLE, DEPT_NAME } from '@/lib/org-map'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(BRIEFING_WRITE_ROLES as readonly string[]).includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / NV QLDA / IT được thao tác giao ban')

    const body = await req.json()
    const { taskId, status, blocked, escalated, execReviewed, reason, briefingPatch, deadline, escalateType, escalateQuestion, blockReason, blockResolverUserId, blockResolverRole, blockSuggestion } = body as { taskId?: string; status?: string; escalated?: boolean; execReviewed?: boolean; escalateType?: string; escalateQuestion?: string; blockReason?: string; blockResolverUserId?: string; blockResolverRole?: string; blockSuggestion?: string } & Partial<SetStatusAdminInput>

    if (!taskId) return errorResponse('Cần taskId', 400)
    if (!status && !briefingPatch && escalated === undefined && execReviewed === undefined) return errorResponse('Cần status, briefingPatch, escalated, hoặc execReviewed', 400)

    if (escalated === true) {
      if (!escalateType?.trim()) return errorResponse('Cần chọn loại lý do đẩy BLĐ', 400)
      if (!escalateQuestion?.trim()) return errorResponse('Cần nhập nội dung BLĐ cần quyết gì', 400)
    }

    let effectiveStatus = status
    if (!effectiveStatus) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } })
      if (!task) return errorResponse('Task không tìm thấy', 404)
      effectiveStatus = task.status
    }

    const mergedPatch = { ...(briefingPatch || {}) }
    if (blocked === true && blockReason) {
      let resolverName = ''
      let resolverNotifyId: string | null = null
      if (blockResolverUserId) {
        const ru = await prisma.user.findUnique({ where: { id: blockResolverUserId }, select: { fullName: true } })
        resolverName = ru?.fullName || ''
        resolverNotifyId = blockResolverUserId
      } else if (blockResolverRole) {
        const dept = ROLE_TO_DEPT[blockResolverRole]
        resolverName = dept ? (DEPT_NAME[dept] || blockResolverRole) : blockResolverRole
        const head = await prisma.user.findFirst({ where: { roleCode: blockResolverRole, isActive: true }, select: { id: true } })
        resolverNotifyId = head?.id || null
      }
      mergedPatch.blockReason = blockReason.trim()
      mergedPatch.blockResolver = { userId: blockResolverUserId || null, role: blockResolverRole || null, name: resolverName }
      mergedPatch.blockedAt = new Date().toISOString()
      if (blockSuggestion) mergedPatch.blockSuggestion = blockSuggestion.trim()
      // Store resolverNotifyId for notification after save
      ;(mergedPatch as Record<string, unknown>)._resolverNotifyId = resolverNotifyId
    }
    if (blocked === false) {
      mergedPatch.blockReason = ''
      mergedPatch.blockResolver = null
      mergedPatch.blockedAt = ''
      mergedPatch.blockSuggestion = ''
    }
    if (escalated === true && escalateType) {
      mergedPatch.escalate = { type: escalateType.trim(), question: (escalateQuestion || '').trim(), byName: payload.fullName || payload.username || 'PM', at: new Date().toISOString() }
    }

    const resolverNotifyId = (mergedPatch as Record<string, unknown>)._resolverNotifyId as string | null | undefined
    delete (mergedPatch as Record<string, unknown>)._resolverNotifyId

    const result = await setTaskStatusAdmin(taskId, payload.userId, { status: effectiveStatus, blocked, escalated, execReviewed, reason, briefingPatch: Object.keys(mergedPatch).length ? mergedPatch : briefingPatch, deadline })

    if (result.wasEscalated) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { title: true, status: true, blocked: true, deadline: true, project: { select: { projectCode: true, projectName: true } }, assignees: true },
      })
      if (task) {
        const uids = task.assignees.map(a => a.userId).filter(Boolean) as string[]
        const users = uids.length ? await prisma.user.findMany({ where: { id: { in: uids } }, select: { fullName: true } }) : []
        const assigneeName = users.map(u => u.fullName).join(', ') || '—'
        const daysOverdue = taskDaysOverdue(task)
        const reasonText = escalateType ? `${escalateType}: ${(escalateQuestion || '').slice(0, 80)}` : (task.blocked ? 'Tắc' : daysOverdue > 0 ? `Quá hạn ${daysOverdue}d` : 'PM đẩy')
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

    // Block notification to resolver
    if (blocked === true && blockReason && resolverNotifyId) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, project: { select: { projectCode: true } } } })
      const projCode = task?.project?.projectCode || ''
      const notifMsg = `Cần tháo gỡ: ${task?.title || taskId} — ${blockReason.trim().slice(0, 100)}${projCode ? ` (${projCode})` : ''}`
      prisma.notification.create({
        data: { userId: resolverNotifyId, title: '🔴 ' + notifMsg, message: blockSuggestion ? `Đề xuất: ${blockSuggestion.trim()}` : notifMsg, type: 'task_blocked', linkUrl: `/dashboard/work/${taskId}` },
      }).catch(() => {})
      const teleMsg = `🔴 <b>Cần tháo gỡ</b>\n${projCode ? `📁 ${projCode}\n` : ''}📋 ${task?.title || taskId}\n❌ ${blockReason.trim()}\n👤 Báo bởi: ${payload.fullName || payload.username || 'PM'}${blockSuggestion ? `\n💡 Đề xuất: ${blockSuggestion.trim()}` : ''}`
      sendDirectMessage(resolverNotifyId, teleMsg).catch(() => {})
    }

    return successResponse(result)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('không hợp lệ') || msg.includes('không tìm thấy')) return errorResponse(msg, 400)
    console.error('PATCH /api/work/briefing/status error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
