import prisma from '@/lib/db'
import { sendGroupMessage, escapeHtml, formatDeadline } from '@/lib/telegram'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import { formatDateTime, formatTimeVN, isTaskOverdue, taskDaysOverdue } from '@/lib/utils'
import { saleClient, SaleClientError } from '@/lib/sale-client'

const TEST_PROJECT_RE = /test/i

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
  const DAY_MS = 86400000

  const uids = new Set<string>()
  for (const t of tasks) for (const a of t.assignees) if (a.userId) uids.add(a.userId)
  const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true } }) : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  function resolveAssignee(assignees: { userId: string | null; role: string | null }[]) {
    if (assignees.length === 0) return '—'
    return assignees.map(a => {
      if (a.userId) return nameById.get(a.userId) || 'NV'
      const dept = DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—'
      return `P.${dept}`
    }).join(', ')
  }

  interface ExecTask { title: string; assignee: string; projCode: string; escalateType: string; escalateQuestion: string }
  interface BlockedTask { title: string; projCode: string; resolverName: string; blockedDays: number }
  interface OverdueTask { title: string; assignee: string; projCode: string; daysOverdue: number }

  const execTasks: ExecTask[] = []
  const blockedTasks: BlockedTask[] = []
  const overdueTasks: OverdueTask[] = []
  let totalDueSoon = 0
  const projectIds = new Set<string>()

  const overdueByProject: Map<string, number> = new Map()
  const overdueByAssignee: Map<string, number> = new Map()

  for (const t of tasks) {
    if (!t.deadline) continue
    const projCode = t.project?.projectCode || ''
    const projName = t.project?.projectName || ''
    if (TEST_PROJECT_RE.test(projCode) || TEST_PROJECT_RE.test(projName)) continue

    const dl = new Date(t.deadline)
    const overdue = isTaskOverdue(t)
    const daysOver = taskDaysOverdue(t)
    const isDueSoon = !!(dl && !overdue && dl >= todayStart && dl <= weekEnd)

    const rd = (t.resultData && typeof t.resultData === 'object') ? (t.resultData as Record<string, unknown>) : {}
    const briefing = (rd.briefing && typeof rd.briefing === 'object') ? (rd.briefing as Record<string, unknown>) : {}
    const reviewedAt = typeof briefing.execReviewedAt === 'string' ? new Date(briefing.execReviewedAt) : null
    const recentlyReviewed = !!(reviewedAt && reviewedAt > sevenDaysAgo)

    const needsExec = t.escalated === true && !recentlyReviewed

    if (!overdue && !isDueSoon && !needsExec && !t.blocked) continue

    if (t.project?.id) projectIds.add(t.project.id)

    const assignee = resolveAssignee(t.assignees)

    if (needsExec) {
      const esc = (briefing.escalate && typeof briefing.escalate === 'object') ? (briefing.escalate as Record<string, string>) : {}
      execTasks.push({ title: t.title, assignee, projCode, escalateType: esc.type || '', escalateQuestion: esc.question || '' })
    }

    if (t.blocked) {
      const blockRes = (briefing.blockResolver && typeof briefing.blockResolver === 'object') ? (briefing.blockResolver as Record<string, string>) : {}
      const blockedAt = typeof briefing.blockedAt === 'string' ? new Date(briefing.blockedAt) : null
      const blockedDays = blockedAt ? Math.max(0, Math.floor((now.getTime() - blockedAt.getTime()) / DAY_MS)) : 0
      blockedTasks.push({ title: t.title, projCode, resolverName: blockRes.name || '—', blockedDays })
    }

    if (overdue) {
      const isReviewLate = t.status === 'AWAITING_REVIEW'
      const responsible = isReviewLate
        ? (nameById.get(t.createdBy) || 'Người giao')
        : assignee
      overdueTasks.push({ title: t.title, assignee: responsible, projCode, daysOverdue: daysOver })
      overdueByProject.set(projCode || 'Chung', (overdueByProject.get(projCode || 'Chung') || 0) + 1)
      if (isReviewLate) {
        const creatorName = nameById.get(t.createdBy) || 'Người giao'
        overdueByAssignee.set(creatorName, (overdueByAssignee.get(creatorName) || 0) + 1)
      } else {
        const names = t.assignees.filter(a => a.userId).map(a => nameById.get(a.userId!) || 'NV')
        for (const n of names) overdueByAssignee.set(n, (overdueByAssignee.get(n) || 0) + 1)
      }
    }

    if (isDueSoon) totalDueSoon++
  }

  overdueTasks.sort((a, b) => b.daysOverdue - a.daysOverdue)
  blockedTasks.sort((a, b) => b.blockedDays - a.blockedDays)

  const hotProject = [...overdueByProject.entries()].sort((a, b) => b[1] - a[1])[0]
  const hotAssignee = [...overdueByAssignee.entries()].sort((a, b) => b[1] - a[1])[0]

  const totalOverdue = overdueTasks.length
  const totalBlocked = blockedTasks.length
  const totalExec = execTasks.length

  // ── Meetings today (VN time) ──
  const todayEndVN = new Date(`${todayVN}T23:59:59.999+07:00`)
  const todayMeetings = await prisma.meeting.findMany({
    where: { status: 'SCHEDULED', startsAt: { gte: todayStart, lte: todayEndVN } },
    include: { invites: { select: { userId: true } } },
    orderBy: { startsAt: 'asc' },
  })
  const meetingUserIds = new Set<string>()
  for (const m of todayMeetings) for (const inv of m.invites) meetingUserIds.add(inv.userId)
  const meetingUsers = meetingUserIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...meetingUserIds] } }, select: { id: true, fullName: true } })
    : []
  const meetingNameById = new Map(meetingUsers.map(u => [u.id, u.fullName]))

  // ── Build message ──
  const dateFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
  const dateStr = dateFmt.format(now)

  const lines: string[] = []
  lines.push(`<b>GIAO BAN NHANH — ${dateStr}</b>`)
  const summary = [
    totalOverdue > 0 ? `${totalOverdue} quá hạn` : null,
    totalDueSoon > 0 ? `${totalDueSoon} sắp hạn` : null,
    totalExec > 0 ? `${totalExec} cần BLĐ quyết` : null,
    totalBlocked > 0 ? `${totalBlocked} tắc` : null,
    `${projectIds.size} dự án`,
  ].filter(Boolean).join(' · ')
  lines.push(summary)

  if (hotProject || hotAssignee) {
    const parts: string[] = []
    if (hotProject) parts.push(`DA nhiều QH nhất: ${escapeHtml(hotProject[0])} (${hotProject[1]})`)
    if (hotAssignee) parts.push(`người: ${escapeHtml(hotAssignee[0])} (${hotAssignee[1]})`)
    lines.push(`<b>Điểm nóng:</b> ${parts.join('; ')}`)
  }

  // Lịch họp hôm nay
  if (todayMeetings.length > 0) {
    lines.push('')
    lines.push(`<b>LỊCH HỌP HÔM NAY (${todayMeetings.length})</b>`)
    for (const m of todayMeetings) {
      const time = formatTimeVN(m.startsAt)
      const loc = m.location ? escapeHtml(m.location) : '—'
      const attendees = m.invites.map(inv => meetingNameById.get(inv.userId) || 'NV').join(', ')
      lines.push(`• ${time} ${escapeHtml(m.title)} · ${loc} · ${escapeHtml(attendees)}`)
    }
  }

  // Cần BLĐ quyết
  if (totalExec > 0) {
    lines.push('')
    lines.push(`<b>CẦN BLĐ QUYẾT (${totalExec})</b>`)
    for (const t of execTasks) {
      const proj = t.projCode ? `${escapeHtml(t.projCode)} ` : ''
      const q = t.escalateQuestion ? ` — "${escapeHtml(t.escalateQuestion.slice(0, 60))}"` : ''
      const ty = t.escalateType ? ` [${escapeHtml(t.escalateType)}]` : ''
      lines.push(`• ${proj}${escapeHtml(t.title.slice(0, 40))} · ${escapeHtml(t.assignee)}${ty}${q}`)
    }
  }

  // Tắc
  if (totalBlocked > 0) {
    lines.push('')
    lines.push(`<b>TẮC (${totalBlocked})</b>`)
    for (const t of blockedTasks) {
      const proj = t.projCode ? `${escapeHtml(t.projCode)} ` : ''
      lines.push(`• ${proj}${escapeHtml(t.title.slice(0, 40))} — chờ ${escapeHtml(t.resolverName)} · tắc ${t.blockedDays}d`)
    }
  }

  // Quá hạn nặng (>=7d)
  const heavyOverdue = overdueTasks.filter(t => t.daysOverdue >= 7)
  const lightOverdue = overdueTasks.filter(t => t.daysOverdue < 7)
  if (heavyOverdue.length > 0) {
    lines.push('')
    lines.push(`<b>QUÁ HẠN NẶNG >=7 ngày (${heavyOverdue.length})</b>`)
    const MAX_LINES = 8
    for (const t of heavyOverdue.slice(0, MAX_LINES)) {
      const proj = t.projCode ? `${escapeHtml(t.projCode)} ` : ''
      lines.push(`• ${proj}${escapeHtml(t.title.slice(0, 40))} · ${escapeHtml(t.assignee)} (+${t.daysOverdue}d)`)
    }
    if (heavyOverdue.length > MAX_LINES) lines.push(`  … và ${heavyOverdue.length - MAX_LINES} việc QH nặng khác`)
  }

  // Remaining overdue + due soon summary
  const remaining: string[] = []
  if (lightOverdue.length > 0) remaining.push(`${lightOverdue.length} quá hạn dưới 7d`)
  if (totalDueSoon > 0) remaining.push(`${totalDueSoon} sắp đến hạn`)
  if (remaining.length > 0) {
    lines.push('')
    lines.push(remaining.join(' · '))
  }

  if (totalOverdue === 0 && totalDueSoon === 0 && totalExec === 0 && totalBlocked === 0) {
    lines.push('')
    lines.push('Không có việc quá hạn, sắp hạn, tắc hoặc cần quyết định.')
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ibshi1.lab.liberico.com.vn'
  lines.push('')
  lines.push(`Xem chi tiết: <a href="${appUrl}/dashboard/work/briefing">Giao ban tuần</a>`)

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

  return { overdue: totalOverdue, dueSoon: totalDueSoon, exec: totalExec, blocked: totalBlocked, meetings: todayMeetings.length, projects: projectIds.size, sentAt: now.toISOString() }
}

// ── Sale Customer Sync ──

const LEGAL_SUFFIX = /\s*(co\.\s*ltd\.?|corp\.?|inc\.?|llc|ltd\.?|jsc|joint[\s-]stock|tnhh|cp)\s*$/i
const LEGAL_PREFIX = /^(cong ty\s+(tnhh|cp|co phan|trach nhiem huu han)\s*)/i

export function normName(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  s = s.replace(LEGAL_PREFIX, '')
  s = s.replace(LEGAL_SUFFIX, '')
  return s.replace(/\s+/g, ' ').trim()
}

const CURSOR_KEY = 'sale_customer_sync_cursor'
const LAST_RUN_KEY = 'sale_customer_sync_last_run'
const MAX_PAGES_PER_RUN = 3

export async function runCustomerSync(): Promise<{ upserted: number; pages: number; cursor: string }> {
  const cursorRow = await prisma.systemConfig.findUnique({ where: { key: CURSOR_KEY } })
  let cursor = cursorRow?.value || '1970-01-01T00:00:00Z'

  let totalUpserted = 0
  let page = 1
  let pagesProcessed = 0
  let maxUpdatedAt = cursor

  for (; pagesProcessed < MAX_PAGES_PER_RUN;) {
    const result = await saleClient.listCustomers({ modifiedSince: cursor, page })
    pagesProcessed++

    for (const c of result.customers) {
      await prisma.saleCustomer.upsert({
        where: { saleCustomerId: c.customerId },
        create: {
          saleCustomerId: c.customerId,
          name: c.name,
          taxCode: c.taxCode || null,
          country: c.country || null,
          address: c.address || null,
          paymentTerms: c.paymentTerms || null,
          nameNorm: normName(c.name),
          saleUpdatedAt: c.updatedAt ? new Date(c.updatedAt) : null,
          lastSyncedAt: new Date(),
        },
        update: {
          name: c.name,
          taxCode: c.taxCode || null,
          country: c.country || null,
          address: c.address || null,
          paymentTerms: c.paymentTerms || null,
          nameNorm: normName(c.name),
          saleUpdatedAt: c.updatedAt ? new Date(c.updatedAt) : null,
          lastSyncedAt: new Date(),
        },
      })
      totalUpserted++
      if (c.updatedAt && c.updatedAt > maxUpdatedAt) maxUpdatedAt = c.updatedAt
    }

    if (!result.hasMore) break
    page++
  }

  cursor = maxUpdatedAt

  await prisma.systemConfig.upsert({
    where: { key: CURSOR_KEY },
    create: { key: CURSOR_KEY, value: cursor },
    update: { value: cursor },
  })
  await prisma.systemConfig.upsert({
    where: { key: LAST_RUN_KEY },
    create: { key: LAST_RUN_KEY, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  })

  console.log(`[CustomerSync] Done: ${totalUpserted} upserted, ${pagesProcessed} pages, cursor=${cursor}`)
  return { upserted: totalUpserted, pages: pagesProcessed, cursor }
}
