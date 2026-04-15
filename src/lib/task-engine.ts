import prisma from './db'
import { TASK_STATUS } from './constants'

// ── Task Inbox Queries ──

export async function getTaskInbox(userId: string, roleCode: string) {
  return prisma.workflowTask.findMany({
    where: {
      OR: [
        { assignedTo: userId },
        { assignedRole: roleCode, assignedTo: null },
      ],
      status: TASK_STATUS.IN_PROGRESS,
    },
    include: {
      project: { select: { projectCode: true, projectName: true, clientName: true } },
      assignee: { select: { fullName: true, username: true } },
    },
    orderBy: [
      { priority: 'desc' },
      { deadline: 'asc' },
      { createdAt: 'asc' },
    ],
  })
}

export async function getTasksByProject(projectId: string) {
  return prisma.workflowTask.findMany({
    where: { projectId },
    include: {
      assignee: { select: { fullName: true, username: true } },
    },
    orderBy: { stepCode: 'asc' },
  })
}

export async function getTaskById(taskId: string) {
  return prisma.workflowTask.findUnique({
    where: { id: taskId },
    include: {
      project: {
        select: {
          projectCode: true, projectName: true, clientName: true,
          productType: true, contractValue: true, currency: true,
          startDate: true, endDate: true, description: true,
        },
      },
      assignee: { select: { id: true, fullName: true, username: true } },
    },
  })
}

// ── Task Assignment (L1 → L2) ──

export async function assignTask(taskId: string, toUserId: string) {
  return prisma.workflowTask.update({
    where: { id: taskId },
    data: { assignedTo: toUserId },
  })
}

// ── Dashboard Aggregations ──

export async function getDashboardStats(roleCode?: string) {
  const where = roleCode && roleCode !== 'R01'
    ? { assignedRole: roleCode }
    : {}

  const [totalTasks, pendingTasks, inProgressTasks, completedTasks, overdueTasks] = await Promise.all([
    prisma.workflowTask.count({ where }),
    prisma.workflowTask.count({ where: { ...where, status: TASK_STATUS.PENDING } }),
    prisma.workflowTask.count({ where: { ...where, status: TASK_STATUS.IN_PROGRESS } }),
    prisma.workflowTask.count({ where: { ...where, status: TASK_STATUS.DONE } }),
    prisma.workflowTask.count({
      where: {
        ...where,
        status: TASK_STATUS.IN_PROGRESS,
        deadline: { lt: new Date() },
      },
    }),
  ])

  return { totalTasks, pendingTasks, inProgressTasks, completedTasks, overdueTasks }
}

export async function getProjectsOverview() {
  const [projects, dailyLogsGrouped, acceptanceLogsGrouped] = await Promise.all([
    prisma.project.findMany({
      where: { status: 'ACTIVE' },
      include: {
        tasks: { select: { stepCode: true, status: true, deadline: true, assignedRole: true, resultData: true } },
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
  ])

  // Role → short department label
  const ROLE_DEPT: Record<string, string> = {
    R01: 'BGĐ', R02: 'PM', R02a: 'PM', R03: 'KTKH', R03a: 'KTKH',
    R04: 'TK', R04a: 'TK', R05: 'KHO', R05a: 'KHO',
    R06: 'SX', R06a: 'SX', R06b: 'SX', R07: 'TM', R07a: 'TM',
    R08: 'KT', R08a: 'KT', R09: 'QC', R09a: 'QC', R10: 'HT',
  }

  return projects.map((p) => {
    const total = p.tasks.length
    const completed = p.tasks.filter((t) => t.status === TASK_STATUS.DONE).length
    const inProgress = p.tasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS).length
    const now = new Date()
    const overdue = p.tasks.filter(
      (t) => t.status === TASK_STATUS.IN_PROGRESS && t.deadline && new Date(t.deadline) < now
    ).length

    // ── Department breakdown ──
    const deptMap: Record<string, { done: number; total: number }> = {}
    for (const t of p.tasks) {
      const dept = ROLE_DEPT[t.assignedRole] || t.assignedRole
      if (!deptMap[dept]) deptMap[dept] = { done: 0, total: 0 }
      deptMap[dept].total++
      if (t.status === TASK_STATUS.DONE) deptMap[dept].done++
    }

    // ── Actual Volume Progress Engine ──
    let estimatedKg = 0
    let completedKg = 0
    let acceptedKg = 0

    // 1. Fetch Plan (Denominator) from P1.2A WBS Import
    const p12aTask = p.tasks.find(t => t.stepCode === 'P1.2A');
    if (p12aTask?.resultData) {
      const planData = p12aTask.resultData as Record<string, any>;
      try {
        const wbsList = typeof planData.wbsItems === 'string' ? JSON.parse(planData.wbsItems) : (planData.wbsItems || []);
        if (wbsList.length > 0) {
          let totalKL = wbsList.reduce((s: number, r: any) => s + (Number(r.khoiLuong) || Number(r.volume) || 0), 0);
          if (wbsList.length > 2) {
            const firstKL = Number(wbsList[0].khoiLuong) || Number(wbsList[0].volume) || 0;
            const restKL = totalKL - firstKL;
            // If the first row is roughly equal to the sum of the rest, it's a summary row and shouldn't be double counted
            if (firstKL > 0 && restKL > 0 && Math.abs(firstKL - restKL) / firstKL < 0.05) {
              totalKL = restKL;
            }
          }
          estimatedKg = totalKL;
        }
      } catch(e) {}
    }

    // 2. Fetch reported volume from Daily Production Logs
    const dLog = dailyLogsGrouped.find((g: any) => g.projectId === p.id);
    if (dLog?._sum?.reportedVolume) {
      completedKg = Number(dLog._sum.reportedVolume) || 0;
    }

    // 3. Fetch PM accepted volume from Weekly Acceptance Logs (P5.4)
    const aLog = acceptanceLogsGrouped.find((g: any) => g.projectId === p.id && g.role === 'PM');
    if (aLog?._sum?.acceptedVolume) {
      acceptedKg = Number(aLog._sum.acceptedVolume) || 0;
    }

    const acceptedPercent = estimatedKg > 0 ? Math.round((acceptedKg / estimatedKg) * 100) : 0
    const completedPercent = estimatedKg > 0 ? Math.round((completedKg / estimatedKg) * 100) : 0

    return {
      id: p.id,
      projectCode: p.projectCode,
      projectName: p.projectName,
      clientName: p.clientName,
      productType: p.productType,
      status: p.status,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
      totalTasks: total,
      completedTasks: completed,
      inProgressTasks: inProgress,
      overdueTasks: overdue,
      deptBreakdown: deptMap,
      volumeProgress: {
        estimatedKg,
        completedKg,
        completedPercent,
        acceptedKg,
        acceptedPercent,
      },
    }
  })
}

export async function getBottleneckMap() {
  const tasks = await prisma.workflowTask.groupBy({
    by: ['assignedRole'],
    where: {
      status: TASK_STATUS.IN_PROGRESS,
    },
    _count: { id: true },
  })

  return tasks.map((t) => ({
    role: t.assignedRole,
    pendingCount: t._count.id,
  })).sort((a, b) => b.pendingCount - a.pendingCount)
}

// ── Deadline Check (for cron/scheduled job) ──

export async function checkDeadlines() {
  const overdueTasks = await prisma.workflowTask.findMany({
    where: {
      status: TASK_STATUS.IN_PROGRESS,
      deadline: { lt: new Date() },
    },
    include: {
      project: { select: { projectCode: true, projectName: true } },
    },
  })

  // Create notifications for overdue tasks
  for (const task of overdueTasks) {
    if (task.assignedTo) {
      await prisma.notification.create({
        data: {
          userId: task.assignedTo,
          title: `Task quá hạn: ${task.stepName}`,
          message: `Task ${task.stepCode} trong dự án ${task.project.projectCode} đã quá deadline.`,
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
    prisma.material.count(),
    prisma.material.findMany({ select: { currentStock: true, minStock: true } })
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
