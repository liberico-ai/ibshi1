import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import { isTaskOverdue, taskDaysOverdue } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

function getMonday(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  out.setDate(out.getDate() - day + (day === 0 ? -6 : 1))
  return out
}

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ')

    const snapshots = await prisma.briefingSnapshot.findMany({
      orderBy: { weekOf: 'desc' },
      take: 20,
      select: { id: true, weekOf: true, createdBy: true, createdAt: true, publishedAt: true, kpi: true },
    })
    return successResponse({ snapshots })
  } catch (err) {
    console.error('GET /api/work/briefing/snapshot error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được chốt kỳ')

    const weekOf = getMonday()
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 86400000)
    const weekFromNow = new Date(now.getTime() + 7 * 86400000)

    const tasks = await prisma.task.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      include: {
        project: { select: { id: true, projectCode: true, projectName: true } },
        assignees: true,
      },
    })

    const uids = new Set<string>()
    for (const t of tasks) for (const a of t.assignees) if (a.userId) uids.add(a.userId)
    const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
    const nameById = new Map(users.map(u => [u.id, u.fullName]))

    let kpiOverdue = 0, kpiBlocked = 0, kpiActive = 0, kpiDueSoon = 0, kpiExecDecision = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasksSnapshot: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decisions: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actionItems: any[] = []

    for (const t of tasks) {
      const overdue = isTaskOverdue(t)
      const daysOver = taskDaysOverdue(t)
      const dl = t.deadline ? new Date(t.deadline) : null
      const dueSoon = !!(dl && !overdue && t.status !== 'DONE' && dl >= now && dl <= weekFromNow)

      const assigneeNames = t.assignees.map(a =>
        a.userId ? (nameById.get(a.userId) || 'NV') : (DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—')
      )

      if (overdue) kpiOverdue++
      if (t.blocked && t.status !== 'DONE') kpiBlocked++
      if (t.status !== 'DONE') kpiActive++
      if (dueSoon) kpiDueSoon++

      const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
      const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
      const execReviewedAt = briefing.execReviewedAt ? new Date(briefing.execReviewedAt as string) : null
      const reviewedRecently = !!(execReviewedAt && (now.getTime() - execReviewedAt.getTime()) < 7 * 86400000)
      const needsExec = t.status !== 'DONE' && t.status !== 'CANCELLED' && (
        t.escalated === true || t.blocked === true || (overdue && daysOver >= 14)
      ) && !reviewedRecently
      if (needsExec) kpiExecDecision++

      if (t.status !== 'DONE') {
        tasksSnapshot.push({
          taskId: t.id,
          projectCode: t.project?.projectCode || '',
          title: t.title,
          status: t.status,
          deadline: t.deadline,
          daysOverdue: daysOver,
          assigneeNames,
        })
      }

      if (briefing.decision && briefing.decisionAt) {
        const decAt = new Date(briefing.decisionAt as string)
        if (decAt >= weekAgo) {
          decisions.push({
            taskId: t.id,
            title: t.title,
            decision: briefing.decision,
            byName: briefing.decisionByName || '',
            at: briefing.decisionAt,
          })
        }
      }

      const items = Array.isArray(briefing.actionItems) ? briefing.actionItems as { taskId: string; title: string }[] : []
      for (const ai of items) {
        actionItems.push({
          taskId: ai.taskId,
          sourceTaskId: t.id,
          title: ai.title,
          assigneeNames,
        })
      }
    }

    const kpi = { total: tasks.length, active: kpiActive, overdue: kpiOverdue, dueSoon: kpiDueSoon, blocked: kpiBlocked, execDecision: kpiExecDecision }

    const snapshot = await prisma.briefingSnapshot.upsert({
      where: { weekOf },
      create: {
        weekOf,
        createdBy: payload.userId,
        kpi,
        tasksSnapshot,
        decisions,
        actionItems,
      },
      update: {
        createdBy: payload.userId,
        kpi,
        tasksSnapshot,
        decisions,
        actionItems,
      },
    })

    return successResponse({ snapshot })
  } catch (err) {
    console.error('POST /api/work/briefing/snapshot error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
