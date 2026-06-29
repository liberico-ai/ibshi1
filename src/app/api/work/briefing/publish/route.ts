import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { BRIEFING_WRITE_ROLES } from '@/lib/constants'
import { sendGroupMessage, sendDirectMessage, escapeHtml } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

function getMonday(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  out.setDate(out.getDate() - day + (day === 0 ? -6 : 1))
  return out
}

function fmtDate(d: Date | string | null): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

interface ActionItem { taskId: string; sourceTaskId: string; title: string; assigneeNames: string[] }
interface Decision { taskId: string; title: string; decision: string; byName: string; at: string }

export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(BRIEFING_WRITE_ROLES as readonly string[]).includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / NV QLDA / IT được phát hành')

    const body = await req.json().catch(() => ({})) as { weekOf?: string; force?: boolean }
    const weekOf = body.weekOf ? getMonday(new Date(body.weekOf)) : getMonday()

    const snapshot = await prisma.briefingSnapshot.findUnique({ where: { weekOf } })
    if (!snapshot) return errorResponse('Chưa chốt kỳ giao ban tuần này. Hãy chốt trước khi phát hành.', 400)

    if (snapshot.publishedAt && !body.force) {
      return successResponse({
        alreadyPublished: true,
        publishedAt: snapshot.publishedAt,
        message: 'Kỳ này đã phát hành. Gửi force=true để phát hành lại.',
      })
    }

    const actionItems = (snapshot.actionItems as unknown as ActionItem[]) || []
    const decisions = (snapshot.decisions as unknown as Decision[]) || []
    const kpi = snapshot.kpi as Record<string, number>

    const allTaskIds = new Set<string>()
    for (const ai of actionItems) allTaskIds.add(ai.taskId)
    for (const d of decisions) allTaskIds.add(d.taskId)

    const tasks = allTaskIds.size > 0
      ? await prisma.task.findMany({
          where: { id: { in: [...allTaskIds] } },
          select: { id: true, title: true, deadline: true, assignees: { select: { userId: true } } },
        })
      : []
    const taskById = new Map(tasks.map(t => [t.id, t]))

    const userMessages = new Map<string, { items: string[]; decisions: string[] }>()
    const addMsg = (userId: string, type: 'items' | 'decisions', msg: string) => {
      if (!userMessages.has(userId)) userMessages.set(userId, { items: [], decisions: [] })
      userMessages.get(userId)![type].push(msg)
    }

    for (const ai of actionItems) {
      const task = taskById.get(ai.taskId)
      if (!task) continue
      const dl = task.deadline ? fmtDate(task.deadline) : 'chưa có hạn'
      const line = `• ${escapeHtml(ai.title)} (hạn ${dl})`
      for (const a of task.assignees) {
        if (a.userId) addMsg(a.userId, 'items', line)
      }
    }

    for (const d of decisions) {
      const task = taskById.get(d.taskId)
      if (!task) continue
      const line = `• ${escapeHtml(d.title)}: <i>${escapeHtml(String(d.decision))}</i>`
      for (const a of task.assignees) {
        if (a.userId) addMsg(a.userId, 'decisions', line)
      }
    }

    const weekLabel = fmtDate(weekOf)
    let sentCount = 0

    for (const [userId, msgs] of userMessages) {
      const parts: string[] = []
      parts.push(`<b>Giao ban tuần ${weekLabel}</b>`)
      if (msgs.items.length > 0) {
        parts.push(`\n<b>Việc được giao (${msgs.items.length}):</b>`)
        parts.push(...msgs.items)
      }
      if (msgs.decisions.length > 0) {
        parts.push(`\n<b>Quyết định liên quan (${msgs.decisions.length}):</b>`)
        parts.push(...msgs.decisions)
      }
      const text = parts.join('\n')

      await sendDirectMessage(userId, text)

      await prisma.notification.create({
        data: {
          userId,
          type: 'BRIEFING_PUBLISHED',
          title: `Giao ban tuần ${weekLabel}`,
          message: msgs.items.length > 0
            ? `Bạn có ${msgs.items.length} việc được giao từ giao ban`
            : `Có ${msgs.decisions.length} quyết định liên quan đến bạn`,
          linkUrl: '/dashboard/work/briefing',
        },
      })
      sentCount++
    }

    const groupText = [
      `<b>Đã chốt giao ban tuần ${weekLabel}</b>`,
      `• ${decisions.length} quyết định`,
      `• ${actionItems.length} việc giao`,
      `• ${kpi.execDecision || 0} việc cần BGĐ quyết`,
      `• ${kpi.overdue || 0} quá hạn · ${kpi.active || 0} đang mở`,
    ].join('\n')
    await sendGroupMessage(groupText)

    await prisma.briefingSnapshot.update({
      where: { weekOf },
      data: { publishedAt: new Date() },
    })

    return successResponse({ published: true, sentTo: sentCount, weekOf: weekOf.toISOString() })
  } catch (err) {
    console.error('POST /api/work/briefing/publish error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
