import prisma from '@/lib/db'
import { sendGroupMessage, escapeHtml, formatDeadline } from '@/lib/telegram'
import { WORKFLOW_RULES, PHASE_LABELS } from '@/lib/workflow-constants'
import { ROLES } from '@/lib/constants'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import { formatDate, formatDateTime, isTaskOverdue, taskDaysOverdue } from '@/lib/utils'

const DYNAMIC_STEPS = new Set(['P5.1', 'P5.1A', 'P5.1.1', 'P5.2', 'P5.3', 'P5.3A', 'P5.4'])

export async function runProjectStatusReport() {
  const now = new Date()

  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, projectCode: true, projectName: true },
    orderBy: { projectCode: 'asc' },
  })

  if (projects.length === 0) {
    await sendGroupMessage('📊 <b>Báo cáo trạng thái dự án</b>\n\nKhông có dự án đang triển khai.')
    return { projects: 0, activeTasks: 0, stuckCount: 0, sentAt: now.toISOString() }
  }

  const tasks = await prisma.task.findMany({
    where: {
      projectId: { in: projects.map(p => p.id) },
      status: 'IN_PROGRESS',
      taskType: { notIn: [...DYNAMIC_STEPS] },
    },
    select: {
      projectId: true,
      taskType: true,
      title: true,
      status: true,
      assignees: { select: { role: true } },
      startedAt: true,
      updatedAt: true,
      deadline: true,
    },
    orderBy: { startedAt: 'asc' },
  })

  const tasksByProject = new Map<string, typeof tasks>()
  for (const t of tasks) {
    if (!t.projectId) continue
    const list = tasksByProject.get(t.projectId) || []
    if (!list.some(existing => existing.taskType === t.taskType)) {
      list.push(t)
    }
    tasksByProject.set(t.projectId, list)
  }

  const lines: string[] = []
  lines.push('📊 <b>BÁO CÁO TRẠNG THÁI DỰ ÁN</b>')
  lines.push(`🕐 ${formatDateTime(now)}`)
  lines.push(`━━━━━━━━━━━━━━━━━━━━`)

  let stuckCount = 0

  for (const project of projects) {
    const projectTasks = tasksByProject.get(project.id)

    if (!projectTasks || projectTasks.length === 0) {
      lines.push('')
      lines.push(`🔵 <b>${escapeHtml(project.projectCode)}</b> — ${escapeHtml(project.projectName)}`)
      lines.push(`   ⚠️ Không có task IN_PROGRESS (có thể đang chờ gate)`)
      stuckCount++
      continue
    }

    lines.push('')
    lines.push(`🟢 <b>${escapeHtml(project.projectCode)}</b> — ${escapeHtml(project.projectName)}`)

    for (const task of projectTasks) {
      const rule = WORKFLOW_RULES[task.taskType]
      const phase = rule ? PHASE_LABELS[rule.phase]?.name || `Phase ${rule.phase}` : '—'
      const taskRole = task.assignees[0]?.role || '—'
      const roleInfo = (ROLES as Record<string, { name: string }>)[taskRole]
      const roleName = roleInfo?.name || taskRole

      const refDate = task.startedAt || task.updatedAt
      const staleDays = refDate
        ? Math.floor((now.getTime() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0

      let staleIcon = '✅'
      if (staleDays >= 7) { staleIcon = '🔴'; stuckCount++ }
      else if (staleDays >= 3) { staleIcon = '🟡' }

      const deadlineStr = task.deadline
        ? formatDate(task.deadline)
        : '—'
      const isOverdue = isTaskOverdue(task)

      let line = `   ${staleIcon} <b>${task.taskType}</b> ${escapeHtml(task.title)}`
      line += `\n      📌 ${escapeHtml(phase)} · 👤 ${escapeHtml(roleName)}`
      line += ` · ⏱ ${staleDays} ngày`
      if (isOverdue) line += ` · ⏰ <b>QUÁ HẠN</b> (DL: ${deadlineStr})`
      else if (task.deadline) line += ` · DL: ${deadlineStr}`

      lines.push(line)
    }
  }

  lines.push('')
  lines.push(`━━━━━━━━━━━━━━━━━━━━`)
  lines.push(`📈 Tổng: <b>${projects.length}</b> dự án · <b>${tasks.length}</b> tasks đang chạy · <b>${stuckCount}</b> cần chú ý`)
  lines.push(`\n🔴 &gt;= 7 ngày · 🟡 &gt;= 3 ngày · ✅ &lt; 3 ngày`)

  const message = lines.join('\n')

  if (message.length > 4096) {
    const chunks: string[] = []
    let current = ''
    for (const line of lines) {
      if ((current + '\n' + line).length > 4000) {
        chunks.push(current)
        current = line
      } else {
        current += (current ? '\n' : '') + line
      }
    }
    if (current) chunks.push(current)
    for (const chunk of chunks) {
      await sendGroupMessage(chunk)
    }
  } else {
    await sendGroupMessage(message)
  }

  return {
    projects: projects.length,
    activeTasks: tasks.length,
    stuckCount,
    sentAt: now.toISOString(),
  }
}

// ══════════════════════════════════════════════════════════════
// Weekly Briefing Digest — sent Monday 8AM
// ══════════════════════════════════════════════════════════════

export async function runWeeklyBriefingDigest() {
  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 86400000)

  const tasks = await prisma.task.findMany({
    where: { status: { notIn: ['DONE', 'CANCELLED'] }, deadline: { not: null } },
    include: {
      project: { select: { id: true, projectCode: true, projectName: true } },
      assignees: true,
    },
    orderBy: { deadline: 'asc' },
  })

  const uids = new Set<string>()
  for (const t of tasks) for (const a of t.assignees) if (a.userId) uids.add(a.userId)
  const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  interface DigestTask { title: string; assignee: string; deadline: Date | null; daysOverdue: number; isOverdue: boolean; isDueSoon: boolean; needsExec: boolean }
  interface ProjectDigest { code: string; name: string; overdue: DigestTask[]; dueSoon: DigestTask[]; exec: DigestTask[] }

  const byProject = new Map<string, ProjectDigest>()
  let totalOverdue = 0, totalDueSoon = 0, totalExec = 0

  for (const t of tasks) {
    const dl = t.deadline ? new Date(t.deadline) : null
    const overdue = isTaskOverdue(t)
    const daysOver = taskDaysOverdue(t)
    const isDueSoon = !!(dl && !overdue && dl >= now && dl <= weekFromNow)
    const needsExec = t.escalated || t.blocked || (overdue && daysOver >= 14)

    const assignee = t.assignees.map(a => a.userId ? (nameById.get(a.userId) || 'NV') : (a.role || '—')).join(', ')
    const dt: DigestTask = { title: t.title, assignee, deadline: t.deadline, daysOverdue: daysOver, isOverdue: overdue, isDueSoon, needsExec }

    const pid = t.project?.id || '__general__'
    if (!byProject.has(pid)) {
      byProject.set(pid, { code: t.project?.projectCode || 'Chung', name: t.project?.projectName || '', overdue: [], dueSoon: [], exec: [] })
    }
    const pg = byProject.get(pid)!
    if (overdue) { pg.overdue.push(dt); totalOverdue++ }
    if (isDueSoon) { pg.dueSoon.push(dt); totalDueSoon++ }
    if (needsExec) { pg.exec.push(dt); totalExec++ }
  }

  const lines: string[] = []
  lines.push('📋 <b>GIAO BAN TUẦN — TỔNG HỢP</b>')
  lines.push(`🕐 ${formatDateTime(now)}`)
  lines.push('━━━━━━━━━━━━━━━━━━━━')

  for (const [, pg] of byProject) {
    if (pg.overdue.length === 0 && pg.dueSoon.length === 0 && pg.exec.length === 0) continue
    lines.push('')
    lines.push(`📁 <b>${escapeHtml(pg.code)}</b> — ${escapeHtml(pg.name)}`)
    if (pg.overdue.length) lines.push(`   🔴 Quá hạn: <b>${pg.overdue.length}</b>`)
    if (pg.dueSoon.length) lines.push(`   🟡 Sắp hạn (≤7d): <b>${pg.dueSoon.length}</b>`)
    if (pg.exec.length) lines.push(`   🔺 Cần BGĐ quyết: <b>${pg.exec.length}</b>`)

    const urgent = [...pg.exec, ...pg.overdue.filter(t => !t.needsExec), ...pg.dueSoon.filter(t => !t.needsExec && !t.isOverdue)]
    for (const t of urgent.slice(0, 5)) {
      const icon = t.needsExec ? '🔺' : t.isOverdue ? '🔴' : '🟡'
      const dlStr = t.deadline ? formatDeadline(t.deadline) : '—'
      const overStr = t.isOverdue ? ` (+${t.daysOverdue}d)` : t.isDueSoon ? ` (còn ${-t.daysOverdue}d)` : ''
      lines.push(`   ${icon} ${escapeHtml(t.title.slice(0, 40))} · ${escapeHtml(t.assignee)} · DL ${dlStr}${overStr}`)
    }
    if (urgent.length > 5) lines.push(`   ... và ${urgent.length - 5} việc khác`)
  }

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━━━━━━')
  lines.push(`📊 <b>Tổng:</b> 🔴 ${totalOverdue} quá hạn · 🟡 ${totalDueSoon} sắp hạn · 🔺 ${totalExec} cần quyết`)

  const message = lines.join('\n')
  if (message.length > 4096) {
    const chunks: string[] = []
    let current = ''
    for (const line of lines) {
      if ((current + '\n' + line).length > 4000) { chunks.push(current); current = line }
      else current += (current ? '\n' : '') + line
    }
    if (current) chunks.push(current)
    for (const chunk of chunks) await sendGroupMessage(chunk)
  } else {
    await sendGroupMessage(message)
  }

  return { projects: byProject.size, overdue: totalOverdue, dueSoon: totalDueSoon, exec: totalExec, sentAt: now.toISOString() }
}

// ══════════════════════════════════════════════════════════════
// Daily Deadline Digest — sent weekdays 8AM VN
// ══════════════════════════════════════════════════════════════

export async function runDailyDeadlineDigest() {
  const now = new Date()

  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
  const todayVN = dayFmt.format(now)
  const todayStart = new Date(`${todayVN}T00:00:00+07:00`)
  const todayEnd = new Date(`${todayVN}T23:59:59.999+07:00`)

  const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' })
  const wdMap: Record<string, number> = { Sun: 0, Mon: 6, Tue: 5, Wed: 4, Thu: 3, Fri: 2, Sat: 1 }
  const daysToSunday = wdMap[wdFmt.format(now)] ?? 0
  const sundayMs = todayStart.getTime() + daysToSunday * 86400000
  const sundayVN = dayFmt.format(new Date(sundayMs))
  const weekEnd = new Date(`${sundayVN}T23:59:59.999+07:00`)

  const tasks = await prisma.task.findMany({
    where: {
      status: { notIn: ['DONE', 'CANCELLED'] },
      deadline: { not: null, gte: todayStart, lte: weekEnd },
    },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      assignees: true,
    },
    orderBy: { deadline: 'asc' },
  })

  const uids = new Set<string>()
  for (const t of tasks) for (const a of t.assignees) if (a.userId) uids.add(a.userId)
  const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  function resolveAssignee(assignees: { userId: string | null; role: string | null }[]) {
    return assignees.map(a => {
      if (a.userId) return nameById.get(a.userId) || 'NV'
      return DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—'
    }).join(', ') || '—'
  }

  const STATUS_LABEL: Record<string, string> = { OPEN: 'Mới', IN_PROGRESS: 'Đang xử lý', AWAITING_REVIEW: 'Chờ duyệt', RETURNED: 'Bị trả lại' }

  interface DeadlineTask { title: string; assignee: string; status: string; deadline: Date; projectKey: string; projectLabel: string }

  const dueToday: DeadlineTask[] = []
  const dueThisWeek: DeadlineTask[] = []

  for (const t of tasks) {
    const dl = new Date(t.deadline!)
    const pKey = t.project?.projectCode || '__general__'
    const pLabel = t.project ? `${t.project.projectCode} — ${t.project.projectName}` : 'Công việc chung'
    const statusText = t.blocked ? 'Tắc' : (STATUS_LABEL[t.status] || t.status)
    const entry: DeadlineTask = { title: t.title, assignee: resolveAssignee(t.assignees), status: statusText, deadline: dl, projectKey: pKey, projectLabel: pLabel }

    if (dl >= todayStart && dl <= todayEnd) dueToday.push(entry)
    else dueThisWeek.push(entry)
  }

  function groupByProject(items: DeadlineTask[]) {
    const map = new Map<string, { label: string; tasks: DeadlineTask[] }>()
    for (const item of items) {
      if (!map.has(item.projectKey)) map.set(item.projectKey, { label: item.projectLabel, tasks: [] })
      map.get(item.projectKey)!.tasks.push(item)
    }
    return [...map.values()]
  }

  const lines: string[] = []
  lines.push('📅 <b>VIỆC ĐẾN HẠN — NHẮC HÀNG NGÀY</b>')
  lines.push(`🕐 ${formatDateTime(now)}`)
  lines.push('━━━━━━━━━━━━━━━━━━━━')

  lines.push('')
  lines.push(`📅 <b>HÔM NAY ĐẾN HẠN (${dueToday.length})</b>`)
  if (dueToday.length === 0) {
    lines.push('   — Không có —')
  } else {
    for (const pg of groupByProject(dueToday)) {
      lines.push(`   📁 <b>${escapeHtml(pg.label)}</b>`)
      for (const t of pg.tasks) {
        lines.push(`      • ${escapeHtml(t.title.slice(0, 50))} · 👤 ${escapeHtml(t.assignee)} · [${escapeHtml(t.status)}] · DL ${formatDeadline(t.deadline)}`)
      }
    }
  }

  lines.push('')
  lines.push(`🗓 <b>TRONG TUẦN ĐẾN HẠN (đến CN, ${dueThisWeek.length})</b>`)
  if (dueThisWeek.length === 0) {
    lines.push('   — Không có —')
  } else {
    for (const pg of groupByProject(dueThisWeek)) {
      lines.push(`   📁 <b>${escapeHtml(pg.label)}</b>`)
      for (const t of pg.tasks) {
        const daysLeft = Math.ceil((t.deadline.getTime() - todayEnd.getTime()) / 86400000)
        lines.push(`      • ${escapeHtml(t.title.slice(0, 50))} · 👤 ${escapeHtml(t.assignee)} · [${escapeHtml(t.status)}] · DL ${formatDeadline(t.deadline)} (còn ${daysLeft}d)`)
      }
    }
  }

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━━━━━━')
  const projectCount = new Set([...dueToday, ...dueThisWeek].map(t => t.projectKey)).size
  lines.push(`📊 <b>Tổng:</b> ${dueToday.length} hôm nay · ${dueThisWeek.length} trong tuần · ${projectCount} dự án`)

  const message = lines.join('\n')
  if (message.length > 4096) {
    const chunks: string[] = []
    let current = ''
    for (const line of lines) {
      if ((current + '\n' + line).length > 4000) { chunks.push(current); current = line }
      else current += (current ? '\n' : '') + line
    }
    if (current) chunks.push(current)
    for (const chunk of chunks) await sendGroupMessage(chunk)
  } else {
    await sendGroupMessage(message)
  }

  return { dueToday: dueToday.length, dueThisWeek: dueThisWeek.length, projects: projectCount, sentAt: now.toISOString() }
}
