/**
 * Xuất báo cáo hoạt động hệ thống IBS-ERP → .docx
 * Chạy: npx tsx scripts/export-usage-report.ts [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 * Mặc định: tuần hiện tại (T2→CN)
 * READ-ONLY — không ghi/sửa DB.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
  WidthType, AlignmentType, BorderStyle, PageOrientation,
} from 'docx'
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

// ── Parse args ──

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

// ── Docx helpers ──

const FONT = 'Arial'
const FONT_SIZE = 20 // half-points → 10pt
const HEADER_SIZE = 24

function txt(text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}): TextRun {
  return new TextRun({ text, font: FONT, size: opts.size ?? FONT_SIZE, bold: opts.bold, color: opts.color, italics: opts.italics })
}

function heading(text: string, level: 'I' | 'II' = 'I'): Paragraph {
  return new Paragraph({
    children: [txt(text, { bold: true, size: level === 'I' ? 28 : HEADER_SIZE })],
    spacing: { before: 240, after: 120 },
    alignment: level === 'I' ? AlignmentType.LEFT : AlignmentType.LEFT,
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [txt('•  ' + text)],
    spacing: { before: 40, after: 40 },
    indent: { left: 360 },
  })
}

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: '000000' }
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }

function cell(text: string, opts: { bold?: boolean; width?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [txt(text, { bold: opts.bold, size: 18 })], alignment: opts.align })],
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    borders: CELL_BORDERS,
  })
}

function headerRow(cols: string[]): TableRow {
  return new TableRow({
    children: cols.map(c => cell(c, { bold: true })),
    tableHeader: true,
  })
}

function dataRow(cols: string[]): TableRow {
  return new TableRow({ children: cols.map(c => cell(c)) })
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

function fmtDateTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Main ──

async function main() {
  const { from, to } = parseArgs()
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
    auditLogs, taskHistories, fileAttachments,
    allUsers, tasksInPeriod, completedTasks,
    activeTasks, projects,
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

  // Supplier quotes from task resultData
  const quoteTaskCount = await prisma.task.count({
    where: { createdAt: { gte: from, lte: to }, taskType: { in: ['P3.3', 'P3.5'] } },
  })

  const userMap = new Map(allUsers.map(u => [u.id, u]))
  const projMap = new Map(projects.map(p => [p.id, p]))

  // ── III. Tổng quan hoạt động ──

  const loginLogs = auditLogs.filter(l => l.action === 'LOGIN')
  const loginCount = loginLogs.length
  const activeUserIds = new Set([
    ...auditLogs.map(l => l.userId),
    ...taskHistories.map(h => h.byUserId),
    ...fileAttachments.map(f => f.uploadedBy),
  ])
  const activeUserCount = activeUserIds.size

  const readActions = new Set(['VIEW', 'READ', 'GET', 'LIST', 'SEARCH', 'EXPORT'])
  const readCount = auditLogs.filter(l => readActions.has(l.action.toUpperCase())).length
  const writeActions = auditLogs.filter(l => !readActions.has(l.action.toUpperCase()) && l.action !== 'LOGIN')
  const writeCount = writeActions.length + taskHistories.length + fileAttachments.length
  const totalLogRecords = auditLogs.length + taskHistories.length

  // ── IV. Các nghiệp vụ đã thực hiện ──

  const bizCounts: Record<string, number> = {}
  for (const h of taskHistories) {
    const label = ACTION_LABEL[h.action] || h.action
    bizCounts[label] = (bizCounts[label] || 0) + 1
  }
  if (fileAttachments.length > 0) bizCounts['Upload tài liệu'] = fileAttachments.length
  if (briefingSnapshots.length > 0) bizCounts['Chốt/Phát hành giao ban'] = briefingSnapshots.length
  if (prCount > 0) bizCounts['Tạo Phiếu đề xuất mua (PR)'] = prCount
  if (poCount > 0) bizCounts['Tạo Đơn đặt hàng (PO)'] = poCount
  if (quoteTaskCount > 0) bizCounts['Báo giá NCC (task)'] = quoteTaskCount

  // Import audit logs
  const importLogs = auditLogs.filter(l => l.action.toLowerCase().includes('import'))
  if (importLogs.length > 0) bizCounts['Import biên bản'] = importLogs.length

  const escalateLogs = taskHistories.filter(h => h.action === 'BLOCKED' || (h as Record<string, unknown>).action === 'STATUS_SET')
  // Escalation from auditLog
  const escalateAudit = auditLogs.filter(l => l.action === 'ESCALATE' || l.entity === 'escalation')
  if (escalateAudit.length > 0) bizCounts['Đẩy BLĐ'] = (bizCounts['Đẩy BLĐ'] || 0) + escalateAudit.length

  const sortedBiz = Object.entries(bizCounts).sort((a, b) => b[1] - a[1])

  // ── V. Chi tiết theo người dùng ──

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
    const u = userActivity.get(h.byUserId)!
    u.actionCount++
    if (!u.lastAt || h.createdAt > u.lastAt) u.lastAt = h.createdAt
  }
  for (const f of fileAttachments) {
    if (!userActivity.has(f.uploadedBy)) userActivity.set(f.uploadedBy, { loginCount: 0, actionCount: 0, lastAt: null })
    const u = userActivity.get(f.uploadedBy)!
    u.actionCount++
    if (!u.lastAt || f.createdAt > u.lastAt) u.lastAt = f.createdAt
  }

  const userRows = [...userActivity.entries()]
    .map(([uid, act]) => {
      const u = userMap.get(uid)
      return { uid, username: u?.username || uid.slice(0, 8), fullName: u?.fullName || '—', dept: DEPT_NAME[ROLE_TO_DEPT[u?.roleCode || '']] || u?.roleCode || '—', ...act }
    })
    .sort((a, b) => b.actionCount - a.actionCount)

  // ── VI. Hoạt động theo dự án ──

  const projActivity: Map<string, { actionCount: number; userIds: Set<string>; mainActions: Map<string, number> }> = new Map()
  // From task histories — match taskId to project
  const taskProjMap: Map<string, string | null> = new Map()
  for (const t of [...tasksInPeriod, ...completedTasks, ...activeTasks]) {
    taskProjMap.set(t.id, t.projectId)
  }
  for (const h of taskHistories) {
    const projId = taskProjMap.get(h.taskId)
    if (!projId) continue
    if (!projActivity.has(projId)) projActivity.set(projId, { actionCount: 0, userIds: new Set(), mainActions: new Map() })
    const pa = projActivity.get(projId)!
    pa.actionCount++
    pa.userIds.add(h.byUserId)
    const label = ACTION_LABEL[h.action] || h.action
    pa.mainActions.set(label, (pa.mainActions.get(label) || 0) + 1)
  }

  const projRows = [...projActivity.entries()]
    .map(([pid, act]) => {
      const p = projMap.get(pid)
      const topActions = [...act.mainActions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(', ')
      return { code: p?.projectCode || pid.slice(0, 8), name: p?.projectName || '', actionCount: act.actionCount, userCount: act.userIds.size, mainTypes: topActions }
    })
    .sort((a, b) => b.actionCount - a.actionCount)

  // ── VII. Truy vết nghiệp vụ thực tế ──

  const prCreated = await prisma.purchaseRequest.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { prCode: true, status: true } })
  const poCreated = await prisma.purchaseOrder.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { poCode: true, status: true } })

  // ── VIII. Tương tác giữa người dùng ──

  const interactions: Map<string, { type: string; count: number; examples: string[] }> = new Map()
  const interactionActions = ['REASSIGNED', 'RETURNED', 'STATUS_RETURNED', 'SUBMITTED_TO_CREATOR', 'COMMENT', 'CREATED', 'ASSIGNED']
  for (const h of taskHistories) {
    if (!interactionActions.includes(h.action)) continue
    const fromId = h.byUserId
    const toId = h.toUserId || h.fromUserId
    if (!toId || fromId === toId) continue
    const fromUser = userMap.get(fromId)
    const toUser = userMap.get(toId)
    const key = `${fromUser?.fullName || fromId.slice(0, 6)} → ${toUser?.fullName || toId.slice(0, 6)}`
    const label = ACTION_LABEL[h.action] || h.action
    if (!interactions.has(key)) interactions.set(key, { type: label, count: 0, examples: [] })
    const entry = interactions.get(key)!
    entry.count++
    const projId = taskProjMap.get(h.taskId)
    const proj = projId ? projMap.get(projId) : null
    if (entry.examples.length < 2 && proj) entry.examples.push(proj.projectCode)
  }

  const interactionRows = [...interactions.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30)

  // ── I. Đang làm (tự tổng hợp) ──

  const blockedTasks = activeTasks.filter(t => t.blocked)
  const escalatedTasks = activeTasks.filter(t => t.escalated)
  const byProjCount: Map<string, number> = new Map()
  for (const t of activeTasks) {
    const pid = t.projectId || '__general__'
    byProjCount.set(pid, (byProjCount.get(pid) || 0) + 1)
  }
  const topProjects = [...byProjCount.entries()]
    .map(([pid, count]) => ({ code: projMap.get(pid)?.projectCode || 'Chung', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // ── Build document ──

  const now = new Date()
  const nowVN = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

  const sections: Paragraph[] = []

  // Title block
  sections.push(new Paragraph({ children: [txt('CÔNG TY CỔ PHẦN CÔNG NGHIỆP NẶNG IBS', { bold: true, size: 26 })], alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60 } }))
  sections.push(new Paragraph({ children: [txt('Hệ thống quản trị IBS-ERP', { size: 22 })], alignment: AlignmentType.CENTER, spacing: { after: 60 } }))
  sections.push(new Paragraph({ children: [txt('BÁO CÁO HOẠT ĐỘNG HỆ THỐNG', { bold: true, size: 32 })], alignment: AlignmentType.CENTER, spacing: { after: 100 } }))
  sections.push(new Paragraph({ children: [txt(`Kỳ báo cáo: tuần ${isoDate(from)} – ${isoDate(to)}`, { size: 22 })], alignment: AlignmentType.CENTER, spacing: { after: 40 } }))
  sections.push(new Paragraph({ children: [txt(`Xuất lúc: ${nowVN} (giờ VN)`, { size: 18, italics: true, color: '666666' })], alignment: AlignmentType.CENTER, spacing: { after: 300 } }))

  // I. ĐANG LÀM
  sections.push(heading('I. ĐANG LÀM'))
  sections.push(bullet(`Tổng việc đang xử lý: ${activeTasks.length}`))
  for (const tp of topProjects) {
    sections.push(bullet(`${tp.code}: ${tp.count} việc đang xử lý`))
  }
  if (blockedTasks.length > 0) sections.push(bullet(`🔴 Tắc: ${blockedTasks.length} việc`))
  if (escalatedTasks.length > 0) sections.push(bullet(`🔺 Cần BLĐ quyết: ${escalatedTasks.length} việc`))
  sections.push(new Paragraph({ children: [txt('(Cho phép sửa tay sau khi xuất)', { italics: true, color: '999999', size: 16 })], spacing: { before: 40, after: 100 } }))

  // II. ĐÃ HOÀN THÀNH TRONG KỲ
  sections.push(heading('II. ĐÃ HOÀN THÀNH TRONG KỲ'))
  if (completedTasks.length === 0) {
    sections.push(bullet('Không có việc hoàn thành trong kỳ'))
  } else {
    sections.push(bullet(`Tổng: ${completedTasks.length} việc hoàn thành`))
    const byProjDone: Map<string, { count: number; titles: string[] }> = new Map()
    for (const t of completedTasks) {
      const pid = t.projectId || '__general__'
      if (!byProjDone.has(pid)) byProjDone.set(pid, { count: 0, titles: [] })
      const entry = byProjDone.get(pid)!
      entry.count++
      if (entry.titles.length < 3) entry.titles.push(t.title.slice(0, 50))
    }
    for (const [pid, info] of [...byProjDone.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8)) {
      const code = projMap.get(pid)?.projectCode || 'Chung'
      sections.push(bullet(`${code}: ${info.count} việc (${info.titles.join('; ')})`))
    }
  }

  // III. TỔNG QUAN HOẠT ĐỘNG
  sections.push(heading('III. TỔNG QUAN HOẠT ĐỘNG'))
  const overviewTable = new Table({
    rows: [
      headerRow(['Chỉ số', 'Giá trị']),
      dataRow(['Tổng lượt đăng nhập', String(loginCount)]),
      dataRow(['Số người dùng hoạt động', String(activeUserCount)]),
      dataRow(['Lượt thao tác đọc/xem', readCount > 0 ? String(readCount) : 'Không có log riêng cho thao tác đọc']),
      dataRow(['Số thao tác ghi (tạo/sửa/nhập/xoá)', String(writeCount)]),
      dataRow(['Tổng bản ghi nhật ký', String(totalLogRecords)]),
    ],
    width: { size: 9000, type: WidthType.DXA },
  })

  // IV. CÁC NGHIỆP VỤ ĐÃ THỰC HIỆN
  sections.push(heading('IV. CÁC NGHIỆP VỤ ĐÃ THỰC HIỆN'))
  const bizRows = [headerRow(['STT', 'Nghiệp vụ', 'Số lượt'])]
  sortedBiz.forEach(([label, count], i) => {
    bizRows.push(dataRow([String(i + 1), label, String(count)]))
  })
  const bizTable = new Table({ rows: bizRows, width: { size: 9000, type: WidthType.DXA } })

  // V. CHI TIẾT THEO NGƯỜI DÙNG
  sections.push(heading('V. CHI TIẾT THEO NGƯỜI DÙNG'))
  const userTableRows = [headerRow(['STT', 'Username', 'Họ tên', 'Phòng ban', 'Đăng nhập', 'Thao tác', 'Gần nhất'])]
  userRows.forEach((u, i) => {
    userTableRows.push(dataRow([String(i + 1), u.username, u.fullName, u.dept, String(u.loginCount), String(u.actionCount), fmtDateTime(u.lastAt)]))
  })
  const userTable = new Table({ rows: userTableRows, width: { size: 9000, type: WidthType.DXA } })

  // VI. HOẠT ĐỘNG THEO DỰ ÁN
  sections.push(heading('VI. HOẠT ĐỘNG THEO DỰ ÁN'))
  const projTableRows = [headerRow(['STT', 'Dự án', 'Số thao tác', 'Số người tham gia', 'Loại chính'])]
  projRows.forEach((p, i) => {
    projTableRows.push(dataRow([String(i + 1), `${p.code}${p.name ? ' — ' + p.name.slice(0, 30) : ''}`, String(p.actionCount), String(p.userCount), p.mainTypes]))
  })
  const projTable = new Table({ rows: projTableRows, width: { size: 9000, type: WidthType.DXA } })

  // VII. TRUY VẾT NGHIỆP VỤ THỰC TẾ
  sections.push(heading('VII. TRUY VẾT NGHIỆP VỤ THỰC TẾ'))
  const traceRows = [headerRow(['Nghiệp vụ', 'Số lượng', 'Trạng thái', 'Chi tiết'])]
  traceRows.push(dataRow(['Việc giao (tạo mới)', String(tasksInPeriod.length), `${tasksInPeriod.filter(t => t.status === 'DONE').length} xong / ${tasksInPeriod.filter(t => t.status !== 'DONE').length} đang xử lý`, '']))

  if (prCreated.length > 0) {
    const prByStatus = prCreated.reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m }, {} as Record<string, number>)
    traceRows.push(dataRow(['Phiếu đề xuất mua (PR)', String(prCreated.length), Object.entries(prByStatus).map(([s, c]) => `${s}: ${c}`).join(', '), prCreated.slice(0, 3).map(p => p.prCode).join(', ')]))
  }

  if (poCreated.length > 0) {
    const poByStatus = poCreated.reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m }, {} as Record<string, number>)
    traceRows.push(dataRow(['Đơn đặt hàng (PO)', String(poCreated.length), Object.entries(poByStatus).map(([s, c]) => `${s}: ${c}`).join(', '), poCreated.slice(0, 3).map(p => p.poCode).join(', ')]))
  }

  if (briefingSnapshots.length > 0) {
    const published = briefingSnapshots.filter(b => b.publishedAt)
    traceRows.push(dataRow(['Biên bản giao ban (chốt kỳ)', String(briefingSnapshots.length), `${published.length} đã phát hành`, '']))
  }

  traceRows.push(dataRow(['Tài liệu upload', String(fileAttachments.length), '—', '']))

  if (quoteTaskCount > 0) {
    traceRows.push(dataRow(['Báo giá NCC (task)', String(quoteTaskCount), '—', '']))
  }

  const traceTable = new Table({ rows: traceRows, width: { size: 9000, type: WidthType.DXA } })

  // VIII. TƯƠNG TÁC GIỮA NGƯỜI DÙNG
  sections.push(heading('VIII. TƯƠNG TÁC GIỮA NGƯỜI DÙNG (theo task/dự án)'))
  const intRows = [headerRow(['Người A → Người B', 'Loại', 'Số lần', 'Task/Dự án tiêu biểu'])]
  for (const [key, val] of interactionRows) {
    intRows.push(dataRow([key, val.type, String(val.count), [...new Set(val.examples)].join(', ')]))
  }
  const intTable = new Table({ rows: intRows, width: { size: 9000, type: WidthType.DXA } })

  // Footer
  const footer = new Paragraph({
    children: [txt('Người lập báo cáo: ………………………………', { size: 20 })],
    spacing: { before: 400 },
  })

  // Assemble doc with tables interleaved
  const children = [
    ...sections.slice(0, sections.findIndex(p => p === sections.find((_, i) => {
      const prev = sections[i]
      return prev && (prev as unknown as { root?: unknown[] })?.root?.toString().includes('TỔNG QUAN')
    }))),
  ]
  // Simpler approach: just lay out sections + tables in order
  const docChildren: (Paragraph | Table)[] = []
  let sectionIdx = 0
  const tableInsertions: { afterHeading: string; table: Table }[] = [
    { afterHeading: 'III.', table: overviewTable },
    { afterHeading: 'IV.', table: bizTable },
    { afterHeading: 'V.', table: userTable },
    { afterHeading: 'VI.', table: projTable },
    { afterHeading: 'VII.', table: traceTable },
    { afterHeading: 'VIII.', table: intTable },
  ]
  let tableIdx = 0

  for (const s of sections) {
    docChildren.push(s)
    if (tableIdx < tableInsertions.length) {
      // Check if this section heading matches next table's heading
      const ti = tableInsertions[tableIdx]
      const sText = JSON.stringify(s)
      if (sText.includes(ti.afterHeading)) {
        docChildren.push(ti.table)
        tableIdx++
      }
    }
  }
  // Append remaining tables
  while (tableIdx < tableInsertions.length) {
    docChildren.push(tableInsertions[tableIdx].table)
    tableIdx++
  }
  docChildren.push(footer)

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT },
          margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 },
        },
      },
      children: docChildren,
    }],
  })

  const outDir = path.join(process.cwd(), 'docs')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `BaoCao-HoatDong-IBSERP-${isoDate(from)}-${isoDate(to)}.docx`)

  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(outPath, buffer)

  console.log(`\n✅ Xuất thành công: ${outPath}`)
  console.log(`\n── Tóm tắt ──`)
  console.log(`Đăng nhập:       ${loginCount} lượt`)
  console.log(`Người dùng HĐ:   ${activeUserCount}`)
  console.log(`Thao tác ghi:    ${writeCount}`)
  console.log(`Task hoàn thành: ${completedTasks.length}`)
  console.log(`Task tạo mới:    ${tasksInPeriod.length}`)
  console.log(`Task đang làm:   ${activeTasks.length}`)
  console.log(`Tắc:             ${blockedTasks.length}`)
  console.log(`PR:              ${prCount}  |  PO: ${poCount}`)
  console.log(`Upload:          ${fileAttachments.length} file`)
  console.log(`Giao ban chốt:   ${briefingSnapshots.length} kỳ`)
  console.log(`Bản ghi log:     ${totalLogRecords}`)

  // Nguồn KHÔNG có
  console.log(`\n── Nguồn không có ──`)
  console.log(`User.lastLoginAt:  KHÔNG CÓ (dùng AuditLog LOGIN thay thế)`)
  console.log(`Login/Session model: KHÔNG CÓ`)
  if (readCount === 0) console.log(`Thao tác đọc/xem:  KHÔNG có log riêng (AuditLog chỉ ghi action ghi)`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('❌ Lỗi:', err)
  process.exit(1)
})
