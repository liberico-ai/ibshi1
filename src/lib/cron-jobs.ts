import prisma from '@/lib/db'
import { sendGroupMessage, escapeHtml, formatDeadline } from '@/lib/telegram'
import { WORKFLOW_RULES, PHASE_LABELS } from '@/lib/workflow-constants'
import { ROLES } from '@/lib/constants'

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

  const tasks = await prisma.workflowTask.findMany({
    where: {
      projectId: { in: projects.map(p => p.id) },
      status: 'IN_PROGRESS',
      stepCode: { notIn: [...DYNAMIC_STEPS] },
    },
    select: {
      projectId: true,
      stepCode: true,
      stepName: true,
      assignedRole: true,
      startedAt: true,
      updatedAt: true,
      deadline: true,
    },
    orderBy: { startedAt: 'asc' },
  })

  const tasksByProject = new Map<string, typeof tasks>()
  for (const t of tasks) {
    const list = tasksByProject.get(t.projectId) || []
    if (!list.some(existing => existing.stepCode === t.stepCode)) {
      list.push(t)
    }
    tasksByProject.set(t.projectId, list)
  }

  const lines: string[] = []
  lines.push('📊 <b>BÁO CÁO TRẠNG THÁI DỰ ÁN</b>')
  lines.push(`🕐 ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`)
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
      const rule = WORKFLOW_RULES[task.stepCode]
      const phase = rule ? PHASE_LABELS[rule.phase]?.name || `Phase ${rule.phase}` : '—'
      const roleInfo = (ROLES as Record<string, { name: string }>)[task.assignedRole]
      const roleName = roleInfo?.name || task.assignedRole

      const refDate = task.startedAt || task.updatedAt
      const staleDays = refDate
        ? Math.floor((now.getTime() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0

      let staleIcon = '✅'
      if (staleDays >= 7) { staleIcon = '🔴'; stuckCount++ }
      else if (staleDays >= 3) { staleIcon = '🟡' }

      const deadlineStr = task.deadline
        ? new Date(task.deadline).toLocaleDateString('vi-VN')
        : '—'
      const isOverdue = task.deadline && new Date(task.deadline) < now

      let line = `   ${staleIcon} <b>${task.stepCode}</b> ${escapeHtml(task.stepName)}`
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
    const daysOverdue = dl ? Math.ceil((now.getTime() - dl.getTime()) / 86400000) : 0
    const isOverdue = daysOverdue > 0
    const isDueSoon = !!(dl && !isOverdue && dl >= now && dl <= weekFromNow)
    const needsExec = t.escalated || t.blocked || (isOverdue && daysOverdue >= 14)

    const assignee = t.assignees.map(a => a.userId ? (nameById.get(a.userId) || 'NV') : (a.role || '—')).join(', ')
    const dt: DigestTask = { title: t.title, assignee, deadline: t.deadline, daysOverdue, isOverdue, isDueSoon, needsExec }

    const pid = t.project?.id || '__general__'
    if (!byProject.has(pid)) {
      byProject.set(pid, { code: t.project?.projectCode || 'Chung', name: t.project?.projectName || '', overdue: [], dueSoon: [], exec: [] })
    }
    const pg = byProject.get(pid)!
    if (isOverdue) { pg.overdue.push(dt); totalOverdue++ }
    if (isDueSoon) { pg.dueSoon.push(dt); totalDueSoon++ }
    if (needsExec) { pg.exec.push(dt); totalExec++ }
  }

  const lines: string[] = []
  lines.push('📋 <b>GIAO BAN TUẦN — TỔNG HỢP</b>')
  lines.push(`🕐 ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`)
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
