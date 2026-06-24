import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { isTaskOverdue, taskDaysOverdue } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

interface SnapshotTask { taskId: string; projectCode: string; title: string; status: string; deadline: string | null; daysOverdue: number; assigneeNames: string[] }
interface SnapshotDecision { taskId: string; title: string; decision: string; byName: string; at: string }
interface SnapshotActionItem { taskId: string; sourceTaskId: string; title: string; assigneeNames: string[] }

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ')

    const lastSnapshot = await prisma.briefingSnapshot.findFirst({
      orderBy: { weekOf: 'desc' },
    })

    if (!lastSnapshot) {
      const weekAgo = new Date(Date.now() - 7 * 86400000)
      const tasks = await prisma.task.findMany({
        where: { status: { notIn: ['CANCELLED'] } },
        select: { id: true, title: true, status: true, deadline: true, blocked: true, resultData: true },
      })

      const followUp: unknown[] = []
      for (const t of tasks) {
        const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
        const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
        if (briefing.decision && briefing.decisionAt) {
          const decAt = new Date(briefing.decisionAt as string)
          if (decAt >= weekAgo) {
            followUp.push({
              taskId: t.id,
              title: t.title,
              decision: briefing.decision,
              byName: briefing.decisionByName || '',
              at: briefing.decisionAt,
              currentStatus: t.status,
              isDone: t.status === 'DONE',
              isOverdue: isTaskOverdue(t),
              daysOverdue: taskDaysOverdue(t),
            })
          }
        }
      }

      return successResponse({
        hasSnapshot: false,
        lastSnapshot: null,
        followUp,
        diff: { new: [], closed: [], slipped: [] },
      })
    }

    const snapshotDecisions = (lastSnapshot.decisions as unknown as SnapshotDecision[]) || []
    const snapshotActionItems = (lastSnapshot.actionItems as unknown as SnapshotActionItem[]) || []
    const snapshotTasks = (lastSnapshot.tasksSnapshot as unknown as SnapshotTask[]) || []

    const allTaskIds = new Set<string>()
    for (const d of snapshotDecisions) allTaskIds.add(d.taskId)
    for (const ai of snapshotActionItems) { allTaskIds.add(ai.taskId); allTaskIds.add(ai.sourceTaskId) }
    for (const st of snapshotTasks) allTaskIds.add(st.taskId)

    const currentTasks = await prisma.task.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      select: { id: true, title: true, status: true, deadline: true, blocked: true, completedAt: true },
    })
    const currentById = new Map(currentTasks.map(t => [t.id, t]))
    const currentIdSet = new Set(currentTasks.filter(t => t.status !== 'DONE').map(t => t.id))
    const snapshotIdSet = new Set(snapshotTasks.map(st => st.taskId))

    const followUp: unknown[] = []
    for (const d of snapshotDecisions) {
      const cur = currentById.get(d.taskId)
      followUp.push({
        taskId: d.taskId,
        title: d.title,
        decision: d.decision,
        byName: d.byName,
        at: d.at,
        currentStatus: cur?.status || 'UNKNOWN',
        isDone: cur?.status === 'DONE',
        isOverdue: cur ? isTaskOverdue(cur) : false,
        daysOverdue: cur ? taskDaysOverdue(cur) : 0,
      })
    }
    for (const ai of snapshotActionItems) {
      const cur = currentById.get(ai.taskId)
      followUp.push({
        taskId: ai.taskId,
        sourceTaskId: ai.sourceTaskId,
        title: ai.title,
        type: 'action-item',
        currentStatus: cur?.status || 'UNKNOWN',
        isDone: cur?.status === 'DONE',
        isOverdue: cur ? isTaskOverdue(cur) : false,
        daysOverdue: cur ? taskDaysOverdue(cur) : 0,
      })
    }

    const newTasks = currentTasks
      .filter(t => t.status !== 'DONE' && !snapshotIdSet.has(t.id))
      .map(t => ({ taskId: t.id, title: t.title, status: t.status }))

    const closedTasks = snapshotTasks
      .filter(st => !currentIdSet.has(st.taskId))
      .map(st => {
        const cur = currentById.get(st.taskId)
        return { taskId: st.taskId, title: st.title, currentStatus: cur?.status || 'REMOVED' }
      })

    const slippedTasks = snapshotTasks
      .filter(st => {
        const cur = currentById.get(st.taskId)
        if (!cur || cur.status === 'DONE') return false
        if (st.deadline && isTaskOverdue(cur) && !isTaskOverdueFromSnapshot(st)) return true
        if (st.deadline && cur.deadline) {
          const oldDl = new Date(st.deadline).getTime()
          const newDl = new Date(cur.deadline).getTime()
          if (newDl > oldDl + 86400000) return true
        }
        return false
      })
      .map(st => {
        const cur = currentById.get(st.taskId)!
        return {
          taskId: st.taskId,
          title: st.title,
          oldDeadline: st.deadline,
          newDeadline: cur.deadline,
          daysOverdue: taskDaysOverdue(cur),
        }
      })

    return successResponse({
      hasSnapshot: true,
      lastSnapshot: { id: lastSnapshot.id, weekOf: lastSnapshot.weekOf, createdAt: lastSnapshot.createdAt, kpi: lastSnapshot.kpi },
      followUp,
      diff: { new: newTasks, closed: closedTasks, slipped: slippedTasks },
    })
  } catch (err) {
    console.error('GET /api/work/briefing/review error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

function isTaskOverdueFromSnapshot(st: SnapshotTask): boolean {
  if (!st.deadline) return false
  const snapshotDeadline = new Date(st.deadline)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  snapshotDeadline.setHours(0, 0, 0, 0)
  return snapshotDeadline < now && st.status !== 'DONE'
}
