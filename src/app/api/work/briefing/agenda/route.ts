import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import { isTaskOverdue, taskDaysOverdue } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được truy cập giao ban tuần')

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 86400000)

    const tasks = await prisma.task.findMany({
      where: {
        status: { notIn: ['CANCELLED'] },
      },
      include: {
        project: { select: { id: true, projectCode: true, projectName: true } },
        assignees: true,
      },
      orderBy: { deadline: 'asc' },
    })

    const uids = new Set<string>()
    for (const t of tasks) {
      for (const a of t.assignees) if (a.userId) uids.add(a.userId)
    }
    const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
    const nameById = new Map(users.map((u) => [u.id, u.fullName]))

    let kpiOverdue = 0
    let kpiBlocked = 0
    let kpiDoneThisWeek = 0
    let kpiNewThisWeek = 0
    let kpiActive = 0
    let kpiDueSoon = 0
    let kpiExecDecision = 0
    const weekFromNow = new Date(now.getTime() + 7 * 86400000)

    const GENERAL_KEY = '__general__'
    const grouped = new Map<string, { project: { id: string; projectCode: string; projectName: string } | null; tasks: ReturnType<typeof mapTask>[] }>()

    function mapTask(t: typeof tasks[number]) {
      const isOverdue = isTaskOverdue(t)
      const daysOverdue = taskDaysOverdue(t)
      const isDoneThisWeek = !!(t.status === 'DONE' && t.completedAt && new Date(t.completedAt) >= weekAgo)
      const isNewThisWeek = new Date(t.createdAt) >= weekAgo && t.status !== 'DONE'
      const dl = t.deadline ? new Date(t.deadline) : null
      const isDueSoon = !!(dl && !isOverdue && t.status !== 'DONE' && t.status !== 'CANCELLED' && dl >= now && dl <= weekFromNow)

      const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
      const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, string> : {}

      const execReviewedAt = briefing.execReviewedAt ? new Date(briefing.execReviewedAt as string) : null
      const reviewedRecently = !!(execReviewedAt && (now.getTime() - execReviewedAt.getTime()) < 7 * 86400000)

      const needsExecDecision = t.status !== 'DONE' && t.status !== 'CANCELLED' && (
        t.escalated === true ||
        t.blocked === true ||
        (isOverdue && daysOverdue >= 14)
      ) && !reviewedRecently

      if (isOverdue) kpiOverdue++
      if (isDueSoon) kpiDueSoon++
      if (t.blocked && t.status !== 'DONE') kpiBlocked++
      if (isDoneThisWeek) kpiDoneThisWeek++
      if (isNewThisWeek) kpiNewThisWeek++
      if (t.status !== 'DONE') kpiActive++
      if (needsExecDecision) kpiExecDecision++

      const assigneeNames = t.assignees.map((a) =>
        a.userId ? (nameById.get(a.userId) || 'NV') : (DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—')
      )
      const assignees = t.assignees.filter(a => a.userId).map(a => ({
        userId: a.userId!,
        name: nameById.get(a.userId!) || 'NV',
      }))
      const actionItems = Array.isArray(briefing.actionItems) ? briefing.actionItems as { taskId: string; title: string }[] : []
      const discussedAt = (typeof briefing.discussedAt === 'string') ? briefing.discussedAt : ''
      return {
        id: t.id,
        taskType: t.taskType,
        title: t.title,
        status: t.status,
        priority: t.priority,
        blocked: t.blocked,
        escalated: t.escalated,
        needsExecDecision,
        startedAt: t.startedAt,
        deadline: t.deadline,
        completedAt: t.completedAt,
        daysOverdue,
        isOverdue,
        isDueSoon,
        isDoneThisWeek,
        isNewThisWeek,
        assigneeNames,
        assignees,
        actionItems,
        discussedAt,
        projectCode: t.project?.projectCode || '',
        criteria: briefing.criteria || '',
        proposal: briefing.proposal || '',
        decision: briefing.decision || '',
        decisionByName: briefing.decisionByName || '',
        decisionAt: briefing.decisionAt || '',
        execReviewedAt: briefing.execReviewedAt || '',
        notes: briefing.notes || '',
      }
    }

    for (const t of tasks) {
      const mapped = mapTask(t)
      const pid = t.project ? t.project.id : GENERAL_KEY
      if (!grouped.has(pid)) {
        grouped.set(pid, { project: t.project || null, tasks: [] })
      }
      grouped.get(pid)!.tasks.push(mapped)
    }

    type MappedTask = ReturnType<typeof mapTask>
    type GroupEntry = {
      project: { id: string; projectCode: string; projectName: string } | null
      tasks: MappedTask[]
      totalTasks: number
      totalOverdue: number
      maxDaysOverdue: number
    }

    const projectGroups: GroupEntry[] = []
    let generalGroup: GroupEntry | null = null

    for (const [key, g] of grouped) {
      const overdueTasks = g.tasks.filter((t) => t.isOverdue)
      const maxDays = overdueTasks.length > 0 ? Math.max(...overdueTasks.map((t) => t.daysOverdue)) : 0
      const entry: GroupEntry = {
        project: g.project,
        tasks: g.tasks.sort((a, b) => {
          if (a.isOverdue && !b.isOverdue) return -1
          if (!a.isOverdue && b.isOverdue) return 1
          return b.daysOverdue - a.daysOverdue
        }),
        totalTasks: g.tasks.length,
        totalOverdue: overdueTasks.length,
        maxDaysOverdue: maxDays,
      }
      if (key === GENERAL_KEY) generalGroup = entry
      else projectGroups.push(entry)
    }

    projectGroups.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue)
    const groups = generalGroup ? [...projectGroups, generalGroup] : projectGroups

    const kpi = {
      total: tasks.length,
      active: kpiActive,
      overdue: kpiOverdue,
      dueSoon: kpiDueSoon,
      blocked: kpiBlocked,
      execDecision: kpiExecDecision,
      doneThisWeek: kpiDoneThisWeek,
      newThisWeek: kpiNewThisWeek,
    }

    return successResponse({ groups, kpi, asOf: now.toISOString() })
  } catch (err) {
    console.error('GET /api/work/briefing/agenda error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
