import prisma from '@/lib/db'
import { sendGroupMessage, escapeHtml, formatDeadline } from '@/lib/telegram'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import { formatDateTime, isTaskOverdue, taskDaysOverdue } from '@/lib/utils'

export async function runDailyDigest() {
  const now = new Date()

  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
  const todayVN = dayFmt.format(now)
  const todayStart = new Date(`${todayVN}T00:00:00+07:00`)

  const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' })
  const wdMap: Record<string, number> = { Sun: 0, Mon: 6, Tue: 5, Wed: 4, Thu: 3, Fri: 2, Sat: 1 }
  const daysToSunday = wdMap[wdFmt.format(now)] ?? 0
  const sundayMs = todayStart.getTime() + daysToSunday * 86400000
  const sundayVN = dayFmt.format(new Date(sundayMs))
  const weekEnd = new Date(`${sundayVN}T23:59:59.999+07:00`)

  const tasks = await prisma.task.findMany({
    where: { status: { notIn: ['DONE', 'CANCELLED'] }, deadline: { not: null } },
    include: {
      project: { select: { id: true, projectCode: true, projectName: true } },
      assignees: true,
    },
    orderBy: { deadline: 'asc' },
  })

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000)

  const uids = new Set<string>()
  for (const t of tasks) for (const a of t.assignees) if (a.userId) uids.add(a.userId)
  const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  function resolveAssignee(assignees: { userId: string | null; role: string | null }[]) {
    if (assignees.length === 0) return '⚠ CHƯA CÓ NGƯỜI PHỤ TRÁCH'
    return assignees.map(a => {
      if (a.userId) return nameById.get(a.userId) || 'NV'
      const dept = DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—'
      return `Phòng ${dept} (chưa cử người)`
    }).join(', ')
  }

  interface DigestTask {
    title: string; assignee: string; deadline: Date
    daysOverdue: number; isOverdue: boolean; isDueSoon: boolean; needsExec: boolean
  }
  interface ProjectDigest {
    code: string; name: string
    overdue: DigestTask[]; dueSoon: DigestTask[]; exec: DigestTask[]
  }

  const byProject = new Map<string, ProjectDigest>()
  let totalOverdue = 0, totalDueSoon = 0, totalExec = 0

  for (const t of tasks) {
    if (!t.deadline) continue
    const dl = new Date(t.deadline)
    const overdue = isTaskOverdue(t)
    const daysOver = taskDaysOverdue(t)
    const isDueSoon = !!(dl && !overdue && dl >= todayStart && dl <= weekEnd)
    const rd = (t.resultData && typeof t.resultData === 'object') ? (t.resultData as Record<string, unknown>) : {}
    const briefing = (rd.briefing && typeof rd.briefing === 'object') ? (rd.briefing as Record<string, unknown>) : {}
    const reviewedAt = typeof briefing.execReviewedAt === 'string' ? new Date(briefing.execReviewedAt) : null
    const recentlyReviewed = !!(reviewedAt && reviewedAt > sevenDaysAgo)
    const needsExec = !!(t.escalated || t.blocked || (overdue && daysOver >= 14)) && !recentlyReviewed

    if (!overdue && !isDueSoon && !needsExec) continue

    const assignee = resolveAssignee(t.assignees)
    const dt: DigestTask = { title: t.title, assignee, deadline: dl, daysOverdue: daysOver, isOverdue: overdue, isDueSoon, needsExec }

    const pid = t.project?.id || '__general__'
    if (!byProject.has(pid)) {
      const code = t.project?.projectCode || 'Chung'
      const name = t.project?.projectName || ''
      byProject.set(pid, { code, name, overdue: [], dueSoon: [], exec: [] })
    }
    const pg = byProject.get(pid)!
    if (overdue) { pg.overdue.push(dt); totalOverdue++ }
    if (isDueSoon) { pg.dueSoon.push(dt); totalDueSoon++ }
    if (needsExec) { pg.exec.push(dt); totalExec++ }
  }

  const lines: string[] = []
  lines.push('📋 <b>TỔNG HỢP CÔNG VIỆC — CẦN HÀNH ĐỘNG</b>')
  lines.push(`🕐 ${formatDateTime(now)}`)
  lines.push('━━━━━━━━━━━━━━━━━━━━')

  for (const [, pg] of byProject) {
    if (pg.overdue.length === 0 && pg.dueSoon.length === 0 && pg.exec.length === 0) continue

    const label = pg.name && pg.name !== pg.code
      ? `${escapeHtml(pg.code)} — ${escapeHtml(pg.name)}`
      : escapeHtml(pg.code)
    lines.push('')
    lines.push(`📁 <b>${label}</b>`)
    if (pg.overdue.length) lines.push(`   🔴 Quá hạn: <b>${pg.overdue.length}</b>`)
    if (pg.dueSoon.length) lines.push(`   🟡 Sắp hạn (≤CN): <b>${pg.dueSoon.length}</b>`)
    if (pg.exec.length) lines.push(`   🔺 Cần BGĐ quyết: <b>${pg.exec.length}</b>`)

    pg.overdue.sort((a, b) => b.daysOverdue - a.daysOverdue)
    const urgent = [
      ...pg.exec,
      ...pg.overdue.filter(t => !t.needsExec),
      ...pg.dueSoon.filter(t => !t.needsExec && !t.isOverdue),
    ]
    for (const t of urgent.slice(0, 5)) {
      const icon = t.needsExec ? '🔺' : t.isOverdue ? '🔴' : '🟡'
      const dlStr = formatDeadline(t.deadline)
      const overStr = t.isOverdue ? ` (+${t.daysOverdue}d)` : ` (còn ${Math.abs(t.daysOverdue)}d)`
      lines.push(`   ${icon} ${escapeHtml(t.title.slice(0, 40))} · 👤 ${escapeHtml(t.assignee)} · DL ${dlStr}${overStr}`)
    }
    if (urgent.length > 5) lines.push(`   ... và ${urgent.length - 5} việc khác`)
  }

  if (totalOverdue === 0 && totalDueSoon === 0 && totalExec === 0) {
    lines.push('')
    lines.push('✅ Không có việc quá hạn, sắp hạn hoặc cần quyết định.')
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

  return { overdue: totalOverdue, dueSoon: totalDueSoon, exec: totalExec, projects: byProject.size, sentAt: now.toISOString() }
}
