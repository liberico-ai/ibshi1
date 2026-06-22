import prisma from './db'
import { TASK_STATUS } from './constants'
import { WORKFLOW_RULES } from './workflow-constants'
import { todayStart, isTaskOverdue } from './utils'

// ── Compatibility adapter: reads from Task (dynamic) table,
// returns WorkflowTask-shaped objects so downstream routes work unchanged. ──

const ACTIVE_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_REVIEW']
const PRIORITY_TO_INT: Record<string, number> = { NORMAL: 0, HIGH: 1, URGENT: 2 }

interface LegacyTask {
  id: string
  projectId: string
  stepCode: string
  stepName: string
  stepNameEn: string
  description: string | null
  assignedRole: string
  assignedTo: string | null
  status: string
  priority: number
  deadline: Date | null
  startedAt: Date | null
  completedAt: Date | null
  completedBy: string | null
  resultData: unknown
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

function toLegacy(t: {
  id: string; projectId: string | null; taskType: string; title: string;
  description: string | null; status: string; priority: string;
  deadline: Date | null; startedAt: Date | null; completedAt: Date | null;
  completedBy: string | null; resultData: unknown; createdAt: Date; updatedAt: Date;
  assignees?: { role: string | null; userId: string | null; isPrimary: boolean }[];
}): LegacyTask {
  const rule = WORKFLOW_RULES[t.taskType]
  const primary = t.assignees?.find(a => a.isPrimary) || t.assignees?.[0]
  const status = t.status === 'OPEN' ? TASK_STATUS.IN_PROGRESS : t.status
  return {
    id: t.id,
    projectId: t.projectId || '',
    stepCode: t.taskType,
    stepName: t.title,
    stepNameEn: rule?.nameEn || '',
    description: t.description,
    assignedRole: primary?.role || rule?.role || '',
    assignedTo: primary?.userId || null,
    status,
    priority: PRIORITY_TO_INT[t.priority] ?? 0,
    deadline: t.deadline,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    completedBy: t.completedBy,
    resultData: t.resultData,
    notes: null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

// ── Task Inbox Queries ──

export async function getTaskInbox(userId: string, roleCode: string) {
  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { status: { in: ACTIVE_STATUSES }, assignees: { some: { OR: [{ userId }, { role: roleCode }] } } },
        { status: 'AWAITING_REVIEW', createdBy: userId },
        { status: 'RETURNED', createdBy: userId },
      ],
    },
    include: {
      project: { select: { projectCode: true, projectName: true, clientName: true } },
      assignees: { select: { role: true, userId: true, isPrimary: true } },
    },
    orderBy: [{ deadline: 'asc' }, { createdAt: 'asc' }],
  })

  const userIds = [...new Set(tasks.flatMap(t => t.assignees.map(a => a.userId).filter(Boolean) as string[]))]
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } }) : []
  const userMap = new Map(users.map(u => [u.id, u]))

  return tasks.map(t => {
    const legacy = toLegacy(t)
    const assignee = legacy.assignedTo ? userMap.get(legacy.assignedTo) : null
    return { ...legacy, project: t.project, assignee: assignee || null }
  })
}

export async function getTasksByProject(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: { assignees: { select: { role: true, userId: true, isPrimary: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const userIds = [...new Set(tasks.flatMap(t => t.assignees.map(a => a.userId).filter(Boolean) as string[]))]
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } }) : []
  const userMap = new Map(users.map(u => [u.id, u]))

  return tasks.map(t => {
    const legacy = toLegacy(t)
    const assignee = legacy.assignedTo ? userMap.get(legacy.assignedTo) : null
    return { ...legacy, assignee: assignee || null }
  })
}

export async function getTaskById(taskId: string) {
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: {
        select: {
          projectCode: true, projectName: true, clientName: true,
          productType: true, contractValue: true, currency: true,
          startDate: true, endDate: true, description: true,
        },
      },
      assignees: { select: { role: true, userId: true, isPrimary: true } },
    },
  })
  if (!t) return null

  const primary = t.assignees?.find(a => a.isPrimary) || t.assignees?.[0]
  let assignee: { id: string; fullName: string; username: string } | null = null
  if (primary?.userId) {
    assignee = await prisma.user.findUnique({
      where: { id: primary.userId },
      select: { id: true, fullName: true, username: true },
    })
  }

  return { ...toLegacy(t), project: t.project, assignee }
}

// ── Task Assignment (L1 → L2) ──

export async function assignTask(taskId: string, toUserId: string) {
  const existing = await prisma.taskAssignee.findFirst({
    where: { taskId, isPrimary: true },
  })
  if (existing) {
    await prisma.taskAssignee.update({
      where: { id: existing.id },
      data: { userId: toUserId },
    })
  } else {
    await prisma.taskAssignee.create({
      data: { taskId, userId: toUserId, isPrimary: true },
    })
  }
  return prisma.task.findUnique({ where: { id: taskId } })
}

// ── Dashboard Aggregations ──

export async function getDashboardStats(roleCode?: string) {
  const base = roleCode && roleCode !== 'R01'
    ? { assignees: { some: { role: roleCode } } }
    : {}
  const [totalTasks, pendingTasks, inProgressTasks, completedTasks, overdueTasks] = await Promise.all([
    prisma.task.count({ where: base }),
    prisma.task.count({ where: { ...base, status: 'OPEN' } }),
    prisma.task.count({ where: { ...base, status: { in: ACTIVE_STATUSES } } }),
    prisma.task.count({ where: { ...base, status: TASK_STATUS.DONE } }),
    prisma.task.count({ where: { ...base, status: { in: ACTIVE_STATUSES }, deadline: { lt: todayStart() } } }),
  ])
  return { totalTasks, pendingTasks, inProgressTasks, completedTasks, overdueTasks }
}

export async function getProjectsOverview() {
  // Read from Task (dynamic) table via dynamicTasks relation
  const [projects, dailyLogsGrouped, acceptanceLogsGrouped, templateStepCount] = await Promise.all([
    prisma.project.findMany({
      where: { status: 'ACTIVE' },
      include: {
        dynamicTasks: {
          include: { assignees: { where: { isPrimary: true }, select: { role: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    (prisma as any).dailyProductionLog.groupBy({
      by: ['projectId'],
      _sum: { reportedVolume: true },
    }).catch(() => []),
    (prisma as any).weeklyAcceptanceLog.groupBy({
      by: ['projectId', 'role'],
      _sum: { acceptedVolume: true },
    }).catch(() => []),
    prisma.templateStep.count({ where: { template: { code: 'SX-PROD' } } }),
  ])

  const ROLE_DEPT: Record<string, string> = {
    R01: 'BGĐ', R02: 'PM', R02a: 'PM', R03: 'KTKH', R03a: 'KTKH',
    R04: 'TK', R04a: 'TK', R05: 'KHO', R05a: 'KHO',
    R06: 'SX', R06a: 'SX', R06b: 'SX', R07: 'TM', R07a: 'TM',
    R08: 'KT', R08a: 'KT', R09: 'QC', R09a: 'QC', R10: 'HT',
  }

  return projects.map((p) => {
    const tasks = p.dynamicTasks as unknown as {
      taskType: string; status: string; deadline: Date | null;
      resultData: unknown; assignees: { role: string | null }[]
    }[]

    const total = Math.max(tasks.length, templateStepCount)
    const completed = tasks.filter((t) => t.status === TASK_STATUS.DONE).length
    const inProgress = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length
    const overdue = tasks.filter(
      (t) => isTaskOverdue(t)
    ).length

    // Department breakdown (from assignees role)
    const deptMap: Record<string, { done: number; total: number }> = {}
    for (const t of tasks) {
      const role = t.assignees?.[0]?.role || WORKFLOW_RULES[t.taskType]?.role || ''
      const dept = ROLE_DEPT[role] || role
      if (!deptMap[dept]) deptMap[dept] = { done: 0, total: 0 }
      deptMap[dept].total++
      if (t.status === TASK_STATUS.DONE) deptMap[dept].done++
    }

    // Volume progress from P1.2A WBS
    let estimatedKg = 0, completedKg = 0, acceptedKg = 0
    const p12aTask = tasks.find(t => t.taskType === 'P1.2A')
    if (p12aTask?.resultData) {
      const planData = p12aTask.resultData as Record<string, any>
      try {
        const wbsList = typeof planData.wbsItems === 'string' ? JSON.parse(planData.wbsItems) : (planData.wbsItems || [])
        if (wbsList.length > 0) {
          let totalKL = wbsList.reduce((s: number, r: any) => s + (Number(r.khoiLuong) || Number(r.volume) || 0), 0)
          if (wbsList.length > 2) {
            const firstKL = Number(wbsList[0].khoiLuong) || Number(wbsList[0].volume) || 0
            const restKL = totalKL - firstKL
            if (firstKL > 0 && restKL > 0 && Math.abs(firstKL - restKL) / firstKL < 0.05) totalKL = restKL
          }
          estimatedKg = totalKL
        }
      } catch {}
    }
    const dLog = dailyLogsGrouped.find((g: any) => g.projectId === p.id)
    if (dLog?._sum?.reportedVolume) completedKg = Number(dLog._sum.reportedVolume) || 0
    const aLog = acceptanceLogsGrouped.find((g: any) => g.projectId === p.id && g.role === 'PM')
    if (aLog?._sum?.acceptedVolume) acceptedKg = Number(aLog._sum.acceptedVolume) || 0
    const acceptedPercent = estimatedKg > 0 ? Math.round((acceptedKg / estimatedKg) * 100) : 0
    const completedPercent = estimatedKg > 0 ? Math.round((completedKg / estimatedKg) * 100) : 0

    return {
      id: p.id, projectCode: p.projectCode, projectName: p.projectName,
      clientName: p.clientName, productType: p.productType, status: p.status,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
      totalTasks: total, completedTasks: completed, inProgressTasks: inProgress, overdueTasks: overdue,
      deptBreakdown: deptMap,
      volumeProgress: { estimatedKg, completedKg, completedPercent, acceptedKg, acceptedPercent },
    }
  })
}

export async function getBottleneckMap() {
  const tasks = await prisma.task.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    select: { assignees: { where: { isPrimary: true }, select: { role: true } } },
  })
  const map = new Map<string, number>()
  for (const t of tasks) {
    const role = t.assignees[0]?.role || 'UNKNOWN'
    map.set(role, (map.get(role) || 0) + 1)
  }
  return [...map.entries()].map(([role, pendingCount]) => ({ role, pendingCount })).sort((a, b) => b.pendingCount - a.pendingCount)
}

// ── Deadline Check (for cron/scheduled job) ──

export async function checkDeadlines() {
  const overdueTasks = await prisma.task.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      deadline: { lt: todayStart() },
    },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      assignees: { where: { isPrimary: true }, select: { userId: true } },
    },
  })

  for (const task of overdueTasks) {
    const userId = task.assignees[0]?.userId
    if (userId) {
      await prisma.notification.create({
        data: {
          userId,
          title: `Task quá hạn: ${task.title}`,
          message: `Task ${task.taskType} trong dự án ${task.project?.projectCode || ''} đã quá deadline.`,
          type: 'deadline_overdue',
          linkUrl: `/tasks/${task.id}`,
        },
      })
    }
  }

  return overdueTasks.length
}

// ── Module Stats for Dashboard ──

export async function getModuleStats() {
  const [
    totalMaterials, lowStockCount,
    totalWO, woInProgress, woPendingMaterial,
    totalInspections, inspectionsPassed, inspectionsPending,
  ] = await Promise.all([
    prisma.material.count({ where: { isProvisional: false } }),
    prisma.material.findMany({ where: { isProvisional: false }, select: { currentStock: true, minStock: true } })
      .then((mats: Array<{ currentStock: unknown; minStock: unknown }>) => mats.filter(m => Number(m.currentStock) < Number(m.minStock)).length),
    prisma.workOrder.count(),
    prisma.workOrder.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.workOrder.count({ where: { status: 'PENDING_MATERIAL' } }),
    prisma.inspection.count(),
    prisma.inspection.count({ where: { status: 'PASSED' } }),
    prisma.inspection.count({ where: { status: 'PENDING' } }),
  ])

  return {
    warehouse: { totalMaterials, lowStockCount: typeof lowStockCount === 'number' ? lowStockCount : 0 },
    production: { totalWO, woInProgress, woPendingMaterial },
    qc: { totalInspections, inspectionsPassed, inspectionsPending },
  }
}
