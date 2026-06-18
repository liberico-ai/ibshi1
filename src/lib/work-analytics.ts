import prisma from './db'
import { ROLE_TO_DEPT, DEPT_NAME } from './org-map'

// ── Phase 4: KPI hiệu suất + tổng quan dự án (đọc dữ liệu thật) ──

function deptOf(role: string | null | undefined): string {
  return (role && ROLE_TO_DEPT[role]) || 'KHAC'
}
const DAY = 86400000

// ── Bảng việc của phòng (cho trưởng phòng xem nhân sự phòng mình đang làm gì) ──
export async function getDeptWorkload(roleCode: string) {
  const dept = ROLE_TO_DEPT[roleCode] || null
  if (!dept) return { deptCode: null, deptName: 'KHAC', members: [] }
  const roles = Object.entries(ROLE_TO_DEPT).filter(([, d]) => d === dept).map(([r]) => r)
  const members = await prisma.user.findMany({
    where: { roleCode: { in: roles }, isActive: true },
    select: { id: true, fullName: true, roleCode: true },
    orderBy: { userLevel: 'asc' },
  })
  const memberIds = members.map((m) => m.id)
  if (!memberIds.length) return { deptCode: dept, deptName: DEPT_NAME[dept] || dept, members: [] }

  const tasks = await prisma.task.findMany({
    where: { assignees: { some: { userId: { in: memberIds } } } },
    select: {
      id: true, title: true, status: true, deadline: true,
      project: { select: { projectCode: true } },
      assignees: { select: { userId: true, done: true } },
    },
    orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
  })
  const now = Date.now()
  const out = members.map((m) => {
    const mine = tasks.filter((t) => t.assignees.some((a) => a.userId === m.id))
    const myDone = (t: typeof tasks[number]) => t.status === 'DONE' || !!t.assignees.find((a) => a.userId === m.id)?.done
    const active = mine.filter((t) => !myDone(t))
    const done = mine.filter((t) => myDone(t))
    const overdue = active.filter((t) => t.deadline && t.deadline.getTime() < now)
    return {
      userId: m.id, fullName: m.fullName, roleCode: m.roleCode,
      counts: { active: active.length, done: done.length, overdue: overdue.length },
      tasks: active.map((t) => ({
        id: t.id, title: t.title, status: t.status,
        projectCode: t.project?.projectCode || null,
        deadline: t.deadline, overdue: !!(t.deadline && t.deadline.getTime() < now),
      })),
    }
  })
  return { deptCode: dept, deptName: DEPT_NAME[dept] || dept, members: out }
}

export async function getPerformance(from?: Date, to?: Date) {
  const start = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const end = to || new Date()

  // Task hoàn thành trong kỳ
  const done = await prisma.task.findMany({
    where: { status: 'DONE', completedAt: { gte: start, lte: end } },
    select: { id: true, deadline: true, assignedAt: true, completedAt: true, returnCount: true, createdBy: true, assignees: { where: { isPrimary: true }, select: { role: true } } },
  })
  // Lượt trả lại trong kỳ (để tính "định tuyến sai" theo phòng người GIAO)
  const returned = await prisma.taskHistory.findMany({
    where: { action: 'RETURNED', createdAt: { gte: start, lte: end } },
    select: { task: { select: { createdBy: true } } },
  })
  // map creator userId → role → dept
  const creatorIds = [...new Set([...done.map((d) => d.createdBy), ...returned.map((r) => r.task?.createdBy).filter(Boolean) as string[]])]
  const users = await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, roleCode: true } })
  const userDept = new Map(users.map((u) => [u.id, deptOf(u.roleCode)]))

  type Row = { dept: string; done: number; onTime: number; late: number; ahead: number; cycleSum: number; returned: number; misRoute: number }
  const rows = new Map<string, Row>()
  const get = (d: string): Row => { if (!rows.has(d)) rows.set(d, { dept: d, done: 0, onTime: 0, late: 0, ahead: 0, cycleSum: 0, returned: 0, misRoute: 0 }); return rows.get(d)! }

  for (const t of done) {
    const dept = deptOf(t.assignees[0]?.role)
    const r = get(dept)
    r.done++
    const completed = t.completedAt!.getTime()
    if (t.deadline) {
      const dl = t.deadline.getTime()
      const allotted = t.assignedAt ? dl - t.assignedAt.getTime() : 0
      if (completed > dl) r.late++
      else if (allotted > 0 && completed <= dl - allotted * 0.2) r.ahead++
      else r.onTime++
    } else r.onTime++
    if (t.assignedAt) r.cycleSum += (completed - t.assignedAt.getTime()) / DAY
    r.returned += t.returnCount
  }
  // mis-route: mỗi lượt RETURNED tính cho phòng của người GIAO (creator)
  for (const rt of returned) {
    const dept = rt.task ? userDept.get(rt.task.createdBy) || 'KHAC' : 'KHAC'
    get(dept).misRoute++
  }

  const result = [...rows.values()].map((r) => {
    const onTimePct = r.done ? Math.round(((r.onTime + r.ahead) / r.done) * 100) : 0
    const avgCycle = r.done ? +(r.cycleSum / r.done).toFixed(1) : 0
    // điểm tổng hợp 0–100
    const score = Math.max(0, Math.min(100, Math.round(
      onTimePct - r.late * 1.5 - r.returned * 2 - r.misRoute * 3,
    )))
    return { deptCode: r.dept, deptName: DEPT_NAME[r.dept] || r.dept, done: r.done, ahead: r.ahead, onTime: r.onTime, late: r.late, onTimePct, avgCycle, returned: r.returned, misRoute: r.misRoute, score }
  }).sort((a, b) => b.score - a.score)

  const totalDone = result.reduce((s, r) => s + r.done, 0)
  const totalOnTime = result.reduce((s, r) => s + r.onTime + r.ahead, 0)
  const totalLate = result.reduce((s, r) => s + r.late, 0)
  const totalReturned = result.reduce((s, r) => s + r.returned, 0)
  return {
    period: { from: start, to: end },
    kpi: {
      onTimePct: totalDone ? Math.round((totalOnTime / totalDone) * 100) : 0,
      late: totalLate, done: totalDone,
      avgCycle: result.length ? +(result.reduce((s, r) => s + r.avgCycle, 0) / result.length).toFixed(1) : 0,
      returnRate: totalDone ? +((totalReturned / totalDone) * 100).toFixed(1) : 0,
    },
    departments: result,
  }
}

// Dashboard (hệ động) — thay cho task-engine cũ
const ACTIVE = ['OPEN', 'IN_PROGRESS', 'RETURNED']

export async function getDynamicDashboardStats(userId?: string, roleCode?: string) {
  // BGĐ (R01) xem toàn hệ thống; còn lại xem việc của mình (theo userId HOẶC role được giao)
  const base = roleCode && roleCode !== 'R01' && userId
    ? { assignees: { some: { OR: [{ userId }, { role: roleCode }] } } }
    : {}
  const [totalTasks, pendingTasks, inProgressTasks, completedTasks, overdueTasks] = await Promise.all([
    prisma.task.count({ where: base }),
    prisma.task.count({ where: { ...base, status: 'OPEN' } }),
    prisma.task.count({ where: { ...base, status: { in: ACTIVE } } }),
    prisma.task.count({ where: { ...base, status: 'DONE' } }),
    prisma.task.count({ where: { ...base, status: { in: ACTIVE }, deadline: { lt: new Date() } } }),
  ])
  return { totalTasks, pendingTasks, inProgressTasks, completedTasks, overdueTasks }
}

export async function getDynamicBottleneck() {
  const tasks = await prisma.task.findMany({
    where: { status: { in: ACTIVE } },
    select: { assignees: { where: { isPrimary: true }, select: { role: true } } },
  })
  const map = new Map<string, number>()
  for (const t of tasks) { const d = deptOf(t.assignees[0]?.role); map.set(d, (map.get(d) || 0) + 1) }
  return [...map.entries()].map(([d, pendingCount]) => ({ role: DEPT_NAME[d] || d, pendingCount })).sort((a, b) => b.pendingCount - a.pendingCount)
}

export async function getMyDynamicTasks(userId: string, roleCode: string) {
  const mine = { assignees: { some: { OR: [{ userId }, { role: roleCode }] } } }
  const [inProgress, done] = await Promise.all([
    prisma.task.count({ where: { ...mine, status: { in: ACTIVE } } }),
    prisma.task.count({ where: { ...mine, status: 'DONE' } }),
  ])
  return { total: inProgress + done, byStatus: { IN_PROGRESS: inProgress, COMPLETED: done } }
}

export async function getProjectOverview(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true, projectName: true, clientName: true, status: true, contractValue: true, currency: true },
  })
  if (!project) return null

  // Tiến độ + chi tiết task động (phòng/trạng thái/người)
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { id: true, title: true, status: true, taskType: true, deadline: true, assignees: { select: { role: true, userId: true, isPrimary: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const total = tasks.length
  const completed = tasks.filter((t) => t.status === 'DONE').length
  const progress = total ? Math.round((completed / total) * 100) : 0
  // theo phase (suy từ taskType P<phase>.x)
  const phaseAgg: Record<string, { total: number; done: number }> = {}
  for (const t of tasks) {
    const m = /^P(\d)/.exec(t.taskType || '')
    const ph = m ? `P${m[1]}` : 'Khác'
    phaseAgg[ph] = phaseAgg[ph] || { total: 0, done: 0 }
    phaseAgg[ph].total++
    if (t.status === 'DONE') phaseAgg[ph].done++
  }

  // Tên + role người nhận (cho cột "ai làm" và để suy phòng ban khi giao theo người)
  const userIds = [...new Set(tasks.flatMap((t) => t.assignees.map((a) => a.userId).filter(Boolean) as string[]))]
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, roleCode: true } }) : []
  const userName = new Map(users.map((u) => [u.id, u.fullName]))
  const userRole = new Map(users.map((u) => [u.id, u.roleCode]))
  const now = Date.now()
  // Phòng của task: ưu tiên role của người nhận chính; nếu giao theo userId thì suy từ roleCode của người đó.
  const taskDept = (t: typeof tasks[number]) => {
    const a = t.assignees.find((x) => x.isPrimary) || t.assignees[0]
    if (!a) return 'KHAC'
    const role = a.role || (a.userId ? userRole.get(a.userId) : null)
    return deptOf(role)
  }

  // Tổng hợp theo phòng ban
  const deptMap = new Map<string, { total: number; active: number; done: number; overdue: number }>()
  const statusSummary = { OPEN: 0, IN_PROGRESS: 0, AWAITING_REVIEW: 0, RETURNED: 0, DONE: 0 } as Record<string, number>
  for (const t of tasks) {
    statusSummary[t.status] = (statusSummary[t.status] || 0) + 1
    const d = taskDept(t)
    const row = deptMap.get(d) || { total: 0, active: 0, done: 0, overdue: 0 }
    row.total++
    if (t.status === 'DONE') row.done++
    else { row.active++; if (t.deadline && t.deadline.getTime() < now) row.overdue++ }
    deptMap.set(d, row)
  }
  const byDept = [...deptMap.entries()].map(([d, v]) => ({ deptCode: d, deptName: DEPT_NAME[d] || d, ...v })).sort((a, b) => b.active - a.active)

  // Danh sách việc đang chạy (cho CEO nhìn ai/phòng/trạng thái/deadline)
  const activeTasks = tasks.filter((t) => t.status !== 'DONE').map((t) => {
    const d = taskDept(t)
    const people = t.assignees.map((a) => a.userId ? (userName.get(a.userId) || 'NV') : null).filter(Boolean) as string[]
    return {
      id: t.id, title: t.title, status: t.status,
      deptName: DEPT_NAME[d] || d,
      assignee: people.length ? people.join(', ') : 'Cả phòng',
      deadline: t.deadline, overdue: !!(t.deadline && t.deadline.getTime() < now),
    }
  })

  // Phễu vật tư: Budget MATERIAL (planned=nhu cầu, committed=đã đặt, actual=đã nhận)
  const budget = await prisma.budget.findFirst({ where: { projectId, category: 'MATERIAL', month: null, year: null } })
  const planned = budget ? Number(budget.planned) : 0
  const committed = budget ? Number(budget.committed) : 0
  const actual = budget ? Number(budget.actual) : 0

  // Tồn gắn dự án (MaterialStock ở kho có projectCode = mã dự án)
  const projStock = await prisma.materialStock.aggregate({
    _sum: { value: true },
    where: { warehouse: { projectCode: project.projectCode }, quantity: { gt: 0 } },
  })
  const inProjectStock = Number(projStock._sum.value || 0)

  return {
    project: { ...project, contractValue: project.contractValue ? Number(project.contractValue) : null },
    progress, totalTasks: total, completedTasks: completed,
    phases: Object.entries(phaseAgg).map(([ph, v]) => ({ phase: ph, pct: v.total ? Math.round((v.done / v.total) * 100) : 0 })).sort((a, b) => a.phase.localeCompare(b.phase)),
    material: {
      demand: planned,            // nhu cầu (BOM)
      ordered: committed,         // đã đặt mua (PO)
      received: actual,           // đã nhận (GRN)
      remaining: Math.max(0, planned - committed),
      inProjectStock,
    },
    statusSummary,
    byDept,
    activeTasks,
  }
}
