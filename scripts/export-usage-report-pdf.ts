/**
 * Xuất báo cáo hoạt động hệ thống IBS-ERP → .pdf
 * Chạy: npx tsx scripts/export-usage-report-pdf.ts [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 * Mặc định: tuần hiện tại (T2→CN)
 * READ-ONLY — không ghi/sửa DB.
 * Dùng Playwright chromium → render HTML → PDF (A4, font Arial, bảng kẻ).
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

const ROLE_TO_DEPT: Record<string, string> = {
  R01: 'BGD', R02: 'QLDA', R02a: 'QLDA', R03: 'KTKH', R03a: 'KTKH',
  R04: 'TK', R04a: 'TK', R05: 'TCKT', R05a: 'TCKT', R06: 'SX',
  R06a: 'SX', R06b: 'SX', R07: 'TM', R07a: 'TM', R08: 'TCKT',
  R08a: 'TCKT', R09: 'QC', R09a: 'QC', R10: 'CNTT', R13: 'TBCG',
}

const DEPT_NAME: Record<string, string> = {
  BGD: 'Ban Giám đốc', CNTT: 'CNTT & Dữ liệu', TK: 'Phòng Kỹ thuật',
  KTKH: 'Kinh tế Kế hoạch', TM: 'Thương mại', QLDA: 'Quản lý Dự án',
  SX: 'Sản xuất', TCKT: 'Tài chính KT & Kho', QC: 'QA/QC', TBCG: 'Thiết bị & Cơ giới',
}

const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Tạo việc', COMPLETED: 'Hoàn thành', STATUS_DONE: 'Hoàn thành (admin)',
  RETURNED: 'Trả lại', STATUS_RETURNED: 'Trả lại (admin)', REASSIGNED: 'Giao lại',
  COMMENT: 'Bình luận', EDITED: 'Chỉnh sửa', SUBMITTED_TO_CREATOR: 'Nộp kết quả',
  CLOSED: 'Kết thúc', BLOCKED: 'Đánh dấu tắc', UNBLOCKED: 'Gỡ tắc',
  STATUS_SET: 'Chuyển trạng thái', STATUS_CANCELLED: 'Hủy', ASSIGNED: 'Giao',
  STARTED: 'Bắt đầu', SUBTASK_CREATED: 'Tạo việc con',
}

function parseArgs() {
  const args = process.argv.slice(2)
  let from: Date | null = null
  let to: Date | null = null
  for (const a of args) {
    if (a.startsWith('--from=')) from = new Date(a.slice(7))
    if (a.startsWith('--to=')) to = new Date(a.slice(5))
  }
  if (!from || !to) {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    from = new Date(now)
    from.setDate(now.getDate() + diffToMon)
    from.setHours(0, 0, 0, 0)
    to = new Date(from)
    to.setDate(from.getDate() + 6)
    to.setHours(23, 59, 59, 999)
  } else {
    from.setHours(0, 0, 0, 0)
    to.setHours(23, 59, 59, 999)
  }
  return { from, to }
}

function fmtDateTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function main() {
  const { from, to } = parseArgs()
  const excludeTest = process.argv.includes('--exclude-test')
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) { console.error('❌ DATABASE_URL không set'); process.exit(1) }
  const isRemote = !connectionString.includes('@localhost') && !connectionString.includes('@127.0.0.1')
  const pool = new pg.Pool({
    connectionString, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000,
    ...(isRemote && { ssl: { rejectUnauthorized: false } }),
  })
  const adapter = new PrismaPg(pool as never)
  const prisma = new PrismaClient({ adapter })

  console.log(`Kỳ báo cáo: ${isoDate(from)} → ${isoDate(to)}`)

  // ── Fetch data (READ-ONLY) ──
  const [
    auditLogsAll, taskHistoriesAll, fileAttachmentsAll,
    allUsers, tasksInPeriodAll, completedTasksAll,
    activeTasksAll, projects,
    prCount, poCount,
    briefingSnapshots,
  ] = await Promise.all([
    prisma.auditLog.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { userId: true, action: true, entity: true, entityId: true, createdAt: true } }),
    prisma.taskHistory.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { action: true, byUserId: true, fromUserId: true, toUserId: true, toRole: true, taskId: true, reason: true, createdAt: true } }),
    prisma.fileAttachment.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { uploadedBy: true, entityType: true, entityId: true, createdAt: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true, fullName: true, roleCode: true } }),
    prisma.task.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { id: true, projectId: true, title: true, status: true, taskType: true, createdBy: true } }),
    prisma.task.findMany({ where: { completedAt: { gte: from, lte: to } }, select: { id: true, title: true, projectId: true, taskType: true, completedBy: true }, orderBy: { completedAt: 'desc' } }),
    prisma.task.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'AWAITING_REVIEW', 'RETURNED'] } }, select: { id: true, title: true, projectId: true, status: true, blocked: true, escalated: true, taskType: true }, orderBy: { deadline: 'asc' } }),
    prisma.project.findMany({ where: { status: 'ACTIVE' }, select: { id: true, projectCode: true, projectName: true } }),
    prisma.purchaseRequest.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.purchaseOrder.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.briefingSnapshot.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { id: true, weekOf: true, publishedAt: true, createdBy: true } }),
  ])

  // ── Loại dữ liệu test (--exclude-test) — cùng logic bản .docx ──
  const TEST_TITLE_MARKERS = ['Phòng TK Test', 'round-trip test', 'ZZ-TEST']
  const testTaskIds = new Set<string>()
  let apiSystemId: string | null = null
  if (excludeTest) {
    const [testProjects, apiUser] = await Promise.all([
      prisma.project.findMany({
        where: { OR: [
          { projectCode: { startsWith: 'ZZ', mode: 'insensitive' } },
          { projectName: { startsWith: 'ZZ', mode: 'insensitive' } },
          { projectName: { contains: 'test', mode: 'insensitive' } },
        ] },
        select: { id: true },
      }),
      prisma.user.findUnique({ where: { username: 'api-system' }, select: { id: true } }),
    ])
    apiSystemId = apiUser?.id ?? null
    const testProjIds = testProjects.map(p => p.id)
    const testTasks = await prisma.task.findMany({
      where: {
        OR: [
          { externalRef: { not: null } },
          { externalSource: 'sale' },
          ...(testProjIds.length ? [{ projectId: { in: testProjIds } }] : []),
          ...(apiSystemId ? [{ createdBy: apiSystemId }] : []),
          ...TEST_TITLE_MARKERS.map(m => ({ title: { contains: m, mode: 'insensitive' as const } })),
        ],
      },
      select: { id: true },
    })
    for (const t of testTasks) testTaskIds.add(t.id)
  }
  const keepTask = (id: string | null | undefined) => !excludeTest || !id || !testTaskIds.has(id)
  const keepUser = (uid: string | null | undefined) => !excludeTest || !apiSystemId || uid !== apiSystemId
  const fileTaskId = (entityId: string) => entityId.split('_')[0]

  const auditLogs = auditLogsAll.filter(l => keepUser(l.userId) && keepTask(l.entityId))
  const taskHistories = taskHistoriesAll.filter(h => keepUser(h.byUserId) && keepTask(h.taskId))
  const fileAttachments = fileAttachmentsAll.filter(f => keepUser(f.uploadedBy) && keepTask(fileTaskId(f.entityId)))
  const tasksInPeriod = tasksInPeriodAll.filter(t => keepTask(t.id))
  const completedTasks = completedTasksAll.filter(t => keepTask(t.id))
  const activeTasks = activeTasksAll.filter(t => keepTask(t.id))

  const quoteTasks = await prisma.task.findMany({ where: { createdAt: { gte: from, lte: to }, taskType: { in: ['P3.3', 'P3.5'] } }, select: { id: true } })
  const quoteTaskCount = quoteTasks.filter(t => keepTask(t.id)).length
  const prCreated = await prisma.purchaseRequest.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { prCode: true, status: true } })
  const poCreated = await prisma.purchaseOrder.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { poCode: true, status: true } })

  const userMap = new Map(allUsers.map(u => [u.id, u]))
  const projMap = new Map(projects.map(p => [p.id, p]))

  // ── Compute metrics ──
  const loginLogs = auditLogs.filter(l => l.action === 'LOGIN')
  const loginCount = loginLogs.length
  const activeUserIds = new Set([...auditLogs.map(l => l.userId), ...taskHistories.map(h => h.byUserId), ...fileAttachments.map(f => f.uploadedBy)])
  const activeUserCount = activeUserIds.size

  const readActions = new Set(['VIEW', 'READ', 'GET', 'LIST', 'SEARCH', 'EXPORT'])
  const readCount = auditLogs.filter(l => readActions.has(l.action.toUpperCase())).length
  const writeCount = auditLogs.filter(l => !readActions.has(l.action.toUpperCase()) && l.action !== 'LOGIN').length + taskHistories.length + fileAttachments.length
  const totalLogRecords = auditLogs.length + taskHistories.length

  // IV. Nghiệp vụ
  const bizCounts: Record<string, number> = {}
  for (const h of taskHistories) { const label = ACTION_LABEL[h.action] || h.action; bizCounts[label] = (bizCounts[label] || 0) + 1 }
  if (fileAttachments.length > 0) bizCounts['Upload tài liệu'] = fileAttachments.length
  if (briefingSnapshots.length > 0) bizCounts['Chốt/Phát hành giao ban'] = briefingSnapshots.length
  if (prCount > 0) bizCounts['Tạo Phiếu đề xuất mua (PR)'] = prCount
  if (poCount > 0) bizCounts['Tạo Đơn đặt hàng (PO)'] = poCount
  if (quoteTaskCount > 0) bizCounts['Báo giá NCC (task)'] = quoteTaskCount
  const importLogs = auditLogs.filter(l => l.action.toLowerCase().includes('import'))
  if (importLogs.length > 0) bizCounts['Import biên bản'] = importLogs.length
  const sortedBiz = Object.entries(bizCounts).sort((a, b) => b[1] - a[1])

  // V. Per-user
  const userActivity: Map<string, { loginCount: number; actionCount: number; lastAt: Date | null }> = new Map()
  for (const l of auditLogs) {
    if (!userActivity.has(l.userId)) userActivity.set(l.userId, { loginCount: 0, actionCount: 0, lastAt: null })
    const u = userActivity.get(l.userId)!
    if (l.action === 'LOGIN') u.loginCount++
    u.actionCount++
    if (!u.lastAt || l.createdAt > u.lastAt) u.lastAt = l.createdAt
  }
  for (const h of taskHistories) {
    if (!userActivity.has(h.byUserId)) userActivity.set(h.byUserId, { loginCount: 0, actionCount: 0, lastAt: null })
    const u = userActivity.get(h.byUserId)!; u.actionCount++
    if (!u.lastAt || h.createdAt > u.lastAt) u.lastAt = h.createdAt
  }
  for (const f of fileAttachments) {
    if (!userActivity.has(f.uploadedBy)) userActivity.set(f.uploadedBy, { loginCount: 0, actionCount: 0, lastAt: null })
    const u = userActivity.get(f.uploadedBy)!; u.actionCount++
    if (!u.lastAt || f.createdAt > u.lastAt) u.lastAt = f.createdAt
  }
  const userRows = [...userActivity.entries()]
    .map(([uid, act]) => { const u = userMap.get(uid); return { username: u?.username || uid.slice(0, 8), fullName: u?.fullName || '—', dept: DEPT_NAME[ROLE_TO_DEPT[u?.roleCode || '']] || u?.roleCode || '—', ...act } })
    .sort((a, b) => b.actionCount - a.actionCount)

  // VI. Per-project
  const taskProjMap: Map<string, string | null> = new Map()
  for (const t of [...tasksInPeriod, ...completedTasks, ...activeTasks]) taskProjMap.set(t.id, t.projectId)
  const projActivity: Map<string, { actionCount: number; userIds: Set<string>; mainActions: Map<string, number> }> = new Map()
  for (const h of taskHistories) {
    const projId = taskProjMap.get(h.taskId); if (!projId) continue
    if (!projActivity.has(projId)) projActivity.set(projId, { actionCount: 0, userIds: new Set(), mainActions: new Map() })
    const pa = projActivity.get(projId)!; pa.actionCount++; pa.userIds.add(h.byUserId)
    const label = ACTION_LABEL[h.action] || h.action; pa.mainActions.set(label, (pa.mainActions.get(label) || 0) + 1)
  }
  const projRows = [...projActivity.entries()]
    .map(([pid, act]) => { const p = projMap.get(pid); const topA = [...act.mainActions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(', '); return { code: p?.projectCode || pid.slice(0, 8), name: p?.projectName || '', actionCount: act.actionCount, userCount: act.userIds.size, mainTypes: topA } })
    .sort((a, b) => b.actionCount - a.actionCount)

  // VIII. Interactions
  const interactions: Map<string, { type: string; count: number; examples: string[] }> = new Map()
  for (const h of taskHistories) {
    if (!['REASSIGNED', 'RETURNED', 'STATUS_RETURNED', 'SUBMITTED_TO_CREATOR', 'COMMENT', 'CREATED', 'ASSIGNED'].includes(h.action)) continue
    const fromId = h.byUserId; const toId = h.toUserId || h.fromUserId; if (!toId || fromId === toId) continue
    const key = `${esc(userMap.get(fromId)?.fullName || fromId.slice(0, 6))} → ${esc(userMap.get(toId)?.fullName || toId.slice(0, 6))}`
    const label = ACTION_LABEL[h.action] || h.action
    if (!interactions.has(key)) interactions.set(key, { type: label, count: 0, examples: [] })
    const entry = interactions.get(key)!; entry.count++
    const projId = taskProjMap.get(h.taskId); const proj = projId ? projMap.get(projId) : null
    if (entry.examples.length < 2 && proj) entry.examples.push(proj.projectCode)
  }
  const interactionRows = [...interactions.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 30)

  // I. Đang làm
  const blockedTasks = activeTasks.filter(t => t.blocked)
  const escalatedTasks = activeTasks.filter(t => t.escalated)
  const byProjCount: Map<string, number> = new Map()
  for (const t of activeTasks) { const pid = t.projectId || '__general__'; byProjCount.set(pid, (byProjCount.get(pid) || 0) + 1) }
  const topProjects = [...byProjCount.entries()].map(([pid, count]) => ({ code: projMap.get(pid)?.projectCode || 'Chung', count })).sort((a, b) => b.count - a.count).slice(0, 5)

  // II. Completed grouping
  const byProjDone: Map<string, { count: number; titles: string[] }> = new Map()
  for (const t of completedTasks) {
    const pid = t.projectId || '__general__'
    if (!byProjDone.has(pid)) byProjDone.set(pid, { count: 0, titles: [] })
    const entry = byProjDone.get(pid)!; entry.count++
    if (entry.titles.length < 3) entry.titles.push(t.title.slice(0, 50))
  }

  const nowVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

  // ── Build HTML ──
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 15mm 18mm 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #222; line-height: 1.45; }
  .title-block { text-align: center; margin-bottom: 20px; }
  .title-block .company { font-size: 12pt; font-weight: bold; margin-bottom: 2px; }
  .title-block .system { font-size: 10.5pt; margin-bottom: 8px; }
  .title-block .main-title { font-size: 16pt; font-weight: bold; margin-bottom: 6px; letter-spacing: 1px; }
  .title-block .period { font-size: 10.5pt; margin-bottom: 2px; }
  .title-block .timestamp { font-size: 8.5pt; color: #888; font-style: italic; }
  h2 { font-size: 11.5pt; margin: 18px 0 8px 0; color: #1a1a1a; border-bottom: 1.5px solid #333; padding-bottom: 3px; }
  ul { margin: 4px 0 10px 22px; }
  li { margin-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 14px 0; font-size: 9pt; }
  th, td { border: 1px solid #999; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #e8e8e8; font-weight: bold; font-size: 8.5pt; }
  tr:nth-child(even) td { background: #fafafa; }
  .r { text-align: right; }
  .c { text-align: center; }
  .note { font-size: 8.5pt; color: #999; font-style: italic; }
  .footer { margin-top: 30px; font-size: 10pt; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>

<div class="title-block">
  <div class="company">CÔNG TY CỔ PHẦN CÔNG NGHIỆP NẶNG IBS</div>
  <div class="system">Hệ thống quản trị IBS-ERP</div>
  <div class="main-title">BÁO CÁO HOẠT ĐỘNG HỆ THỐNG</div>
  <div class="period">Kỳ báo cáo: tuần ${isoDate(from)} – ${isoDate(to)}</div>
  <div class="timestamp">Xuất lúc: ${nowVN} (giờ VN)</div>
  ${excludeTest ? `<div class="note" style="margin-top:4px;">(Đã loại dữ liệu test: task do API external đẩy vào + task/dự án có dấu hiệu test — ${testTaskIds.size} task)</div>` : ''}
</div>

<h2>I. ĐANG LÀM</h2>
<ul>
  <li>Tổng việc đang xử lý: <b>${activeTasks.length}</b></li>
  ${topProjects.map(tp => `<li>${esc(tp.code)}: ${tp.count} việc đang xử lý</li>`).join('\n  ')}
  ${blockedTasks.length > 0 ? `<li>🔴 Tắc: <b>${blockedTasks.length}</b> việc</li>` : ''}
  ${escalatedTasks.length > 0 ? `<li>🔺 Cần BLĐ quyết: <b>${escalatedTasks.length}</b> việc</li>` : ''}
</ul>
<p class="note">(Cho phép sửa tay sau khi xuất)</p>

<h2>II. ĐÃ HOÀN THÀNH TRONG KỲ</h2>
<ul>
  <li>Tổng: <b>${completedTasks.length}</b> việc hoàn thành</li>
  ${[...byProjDone.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8).map(([pid, info]) => {
    const code = projMap.get(pid)?.projectCode || 'Chung'
    return `<li>${esc(code)}: ${info.count} việc (${esc(info.titles.join('; '))})</li>`
  }).join('\n  ')}
</ul>

<h2>III. TỔNG QUAN HOẠT ĐỘNG</h2>
<table>
  <tr><th style="width:55%">Chỉ số</th><th>Giá trị</th></tr>
  <tr><td>Tổng lượt đăng nhập</td><td class="r">${loginCount}</td></tr>
  <tr><td>Số người dùng hoạt động</td><td class="r">${activeUserCount}</td></tr>
  <tr><td>Lượt thao tác đọc/xem</td><td class="r">${readCount > 0 ? readCount : '<span class="note">Không có log riêng</span>'}</td></tr>
  <tr><td>Số thao tác ghi (tạo/sửa/nhập/xoá)</td><td class="r">${writeCount}</td></tr>
  <tr><td>Tổng bản ghi nhật ký</td><td class="r">${totalLogRecords}</td></tr>
</table>

<h2>IV. CÁC NGHIỆP VỤ ĐÃ THỰC HIỆN</h2>
<table>
  <tr><th class="c" style="width:40px">STT</th><th>Nghiệp vụ</th><th class="r" style="width:80px">Số lượt</th></tr>
  ${sortedBiz.map(([label, count], i) => `<tr><td class="c">${i + 1}</td><td>${esc(label)}</td><td class="r">${count}</td></tr>`).join('\n  ')}
</table>

<div class="page-break"></div>

<h2>V. CHI TIẾT THEO NGƯỜI DÙNG</h2>
<table>
  <tr><th class="c" style="width:30px">STT</th><th>Username</th><th>Họ tên</th><th>Phòng ban</th><th class="r">Đăng nhập</th><th class="r">Thao tác</th><th>Gần nhất</th></tr>
  ${userRows.map((u, i) => `<tr><td class="c">${i + 1}</td><td>${esc(u.username)}</td><td>${esc(u.fullName)}</td><td>${esc(u.dept)}</td><td class="r">${u.loginCount}</td><td class="r">${u.actionCount}</td><td>${fmtDateTime(u.lastAt)}</td></tr>`).join('\n  ')}
</table>

<h2>VI. HOẠT ĐỘNG THEO DỰ ÁN</h2>
<table>
  <tr><th class="c" style="width:30px">STT</th><th>Dự án</th><th class="r" style="width:70px">Thao tác</th><th class="r" style="width:60px">Người</th><th>Loại chính</th></tr>
  ${projRows.map((p, i) => `<tr><td class="c">${i + 1}</td><td>${esc(p.code)}${p.name ? ' — ' + esc(p.name.slice(0, 35)) : ''}</td><td class="r">${p.actionCount}</td><td class="r">${p.userCount}</td><td>${esc(p.mainTypes)}</td></tr>`).join('\n  ')}
</table>

<h2>VII. TRUY VẾT NGHIỆP VỤ THỰC TẾ</h2>
<table>
  <tr><th>Nghiệp vụ</th><th class="r" style="width:65px">Số lượng</th><th>Trạng thái</th><th>Chi tiết</th></tr>
  <tr><td>Việc giao (tạo mới)</td><td class="r">${tasksInPeriod.length}</td><td>${tasksInPeriod.filter(t => t.status === 'DONE').length} xong / ${tasksInPeriod.filter(t => t.status !== 'DONE').length} đang xử lý</td><td></td></tr>
  ${prCreated.length > 0 ? (() => {
    const s = prCreated.reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m }, {} as Record<string, number>)
    return `<tr><td>Phiếu đề xuất mua (PR)</td><td class="r">${prCreated.length}</td><td>${Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(', ')}</td><td>${prCreated.slice(0, 3).map(p => p.prCode).join(', ')}</td></tr>`
  })() : ''}
  ${poCreated.length > 0 ? (() => {
    const s = poCreated.reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m }, {} as Record<string, number>)
    return `<tr><td>Đơn đặt hàng (PO)</td><td class="r">${poCreated.length}</td><td>${Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(', ')}</td><td>${poCreated.slice(0, 3).map(p => p.poCode).join(', ')}</td></tr>`
  })() : ''}
  ${briefingSnapshots.length > 0 ? `<tr><td>Biên bản giao ban (chốt kỳ)</td><td class="r">${briefingSnapshots.length}</td><td>${briefingSnapshots.filter(b => b.publishedAt).length} đã phát hành</td><td></td></tr>` : ''}
  <tr><td>Tài liệu upload</td><td class="r">${fileAttachments.length}</td><td>—</td><td></td></tr>
  ${quoteTaskCount > 0 ? `<tr><td>Báo giá NCC (task)</td><td class="r">${quoteTaskCount}</td><td>—</td><td></td></tr>` : ''}
</table>

<h2>VIII. TƯƠNG TÁC GIỮA NGƯỜI DÙNG (theo task/dự án)</h2>
<table>
  <tr><th>Người A → Người B</th><th>Loại</th><th class="r" style="width:55px">Số lần</th><th>Task/Dự án tiêu biểu</th></tr>
  ${interactionRows.length > 0 ? interactionRows.map(([key, val]) => `<tr><td>${key}</td><td>${esc(val.type)}</td><td class="r">${val.count}</td><td>${esc([...new Set(val.examples)].join(', '))}</td></tr>`).join('\n  ') : '<tr><td colspan="4" class="c note">Không có dữ liệu tương tác trong kỳ</td></tr>'}
</table>

<div class="footer">
  <p>Người lập báo cáo: …………………………………</p>
</div>

</body>
</html>`

  // ── Render PDF via Playwright ──
  console.log('Rendering PDF...')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle' })

  const outDir = path.join(process.cwd(), 'docs')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `BaoCao-HoatDong-IBSERP-${isoDate(from)}-${isoDate(to)}.pdf`)

  await page.pdf({
    path: outPath,
    format: 'A4',
    margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#aaa;">IBS-ERP · Trang <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  })

  await browser.close()
  await prisma.$disconnect()

  console.log(`\n✅ Xuất PDF thành công: ${outPath}`)
  if (excludeTest) console.log(`🧹 Đã loại dữ liệu test: ${testTaskIds.size} task (API external + dấu hiệu test)${apiSystemId ? ' + user api-system' : ''}`)
  console.log(`\n── Tóm tắt ──`)
  console.log(`Đăng nhập:       ${loginCount} lượt`)
  console.log(`Người dùng HĐ:   ${activeUserCount}`)
  console.log(`Thao tác ghi:    ${writeCount}`)
  console.log(`Task hoàn thành: ${completedTasks.length}`)
  console.log(`Task tạo mới:    ${tasksInPeriod.length}`)
  console.log(`Task đang làm:   ${activeTasks.length}`)
  console.log(`PR: ${prCount}  |  PO: ${poCount}  |  Upload: ${fileAttachments.length}`)
}

main().catch(err => { console.error('❌ Lỗi:', err); process.exit(1) })
