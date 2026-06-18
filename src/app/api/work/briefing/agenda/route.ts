import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được truy cập giao ban tuần')

    const now = new Date()

    const overdueTasks = await prisma.task.findMany({
      where: {
        deadline: { lt: now },
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      include: {
        project: { select: { id: true, projectCode: true, projectName: true } },
        assignees: true,
      },
      orderBy: { deadline: 'asc' },
    })

    const uids = new Set<string>()
    for (const t of overdueTasks) {
      for (const a of t.assignees) if (a.userId) uids.add(a.userId)
    }
    const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
    const nameById = new Map(users.map((u) => [u.id, u.fullName]))

    const GENERAL_KEY = '__general__'
    const grouped = new Map<string, { project: { id: string; projectCode: string; projectName: string } | null; tasks: typeof overdueTasks }>()

    for (const t of overdueTasks) {
      const pid = t.project ? t.project.id : GENERAL_KEY
      if (!grouped.has(pid)) {
        grouped.set(pid, { project: t.project || null, tasks: [] })
      }
      grouped.get(pid)!.tasks.push(t)
    }

    function mapTask(t: typeof overdueTasks[number]) {
      const daysOverdue = Math.ceil((now.getTime() - new Date(t.deadline!).getTime()) / 86400000)
      const assigneeNames = t.assignees.map((a) =>
        a.userId ? (nameById.get(a.userId) || 'NV') : (DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—')
      )
      const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
      const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, string> : {}
      return {
        id: t.id,
        taskType: t.taskType,
        title: t.title,
        status: t.status,
        priority: t.priority,
        startedAt: t.startedAt,
        deadline: t.deadline,
        daysOverdue,
        assigneeNames,
        criteria: briefing.criteria || '',
        proposal: briefing.proposal || '',
        decision: briefing.decision || '',
        notes: briefing.notes || '',
        blocked: briefing.blocked || '',
      }
    }

    type GroupEntry = {
      project: { id: string; projectCode: string; projectName: string } | null
      tasks: ReturnType<typeof mapTask>[]
      totalOverdue: number
      maxDaysOverdue: number
    }

    const projectGroups: GroupEntry[] = []
    let generalGroup: GroupEntry | null = null

    for (const [key, g] of grouped) {
      const tasks = g.tasks.map(mapTask).sort((a, b) => b.daysOverdue - a.daysOverdue)
      const maxDays = Math.max(...tasks.map((t) => t.daysOverdue))
      const entry: GroupEntry = { project: g.project, tasks, totalOverdue: g.tasks.length, maxDaysOverdue: maxDays }
      if (key === GENERAL_KEY) generalGroup = entry
      else projectGroups.push(entry)
    }

    projectGroups.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue)
    const groups = generalGroup ? [...projectGroups, generalGroup] : projectGroups

    return successResponse({ groups, totalTasks: overdueTasks.length, asOf: now.toISOString() })
  } catch (err) {
    console.error('GET /api/work/briefing/agenda error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
