// ══════════════════════════════════════════════════════════════
// Telegram Notification Formatters — Push to company group
// Called by workflow-engine.ts and deadline-check cron
// ALL calls are fire-and-forget — errors never block workflow
// ══════════════════════════════════════════════════════════════

import { sendGroupMessage, escapeHtml, formatDeadline } from '@/lib/telegram'
import { ROLES } from '@/lib/constants'

// ── Shared helpers ──────────────────────────────────────────

function roleName(roleCode: string): string {
  return (ROLES as Record<string, { name: string }>)[roleCode]?.name || roleCode
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || ''
}

/** Build Telegram mention: <a href="tg://user?id=123">Name</a> */
function mention(telegramChatId: string, fullName: string): string {
  return `<a href="tg://user?id=${telegramChatId}">${escapeHtml(fullName)}</a>`
}

// ── Task Activated → Group notification + tag users ─────────

interface TaskNotifyData {
  stepCode: string
  stepName: string
  projectCode: string
  projectName: string
  assignedRole: string
  deadline: Date | null
  taskId: string
}

interface MentionUser {
  fullName: string
  telegramChatId: string | null
}

export async function notifyTaskActivated(data: TaskNotifyData & {
  mentionUsers?: MentionUser[]
}): Promise<void> {
  const url = appUrl()

  // Build mention line: tag users who have linked Telegram
  const mentions = (data.mentionUsers || [])
    .filter(u => u.telegramChatId)
    .map(u => mention(u.telegramChatId!, u.fullName))
  const mentionLine = mentions.length > 0
    ? `👥 Giao cho: ${mentions.join(', ')}`
    : null

  const msg = [
    '📋 <b>CÔNG VIỆC MỚI</b>',
    '━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `👤 Phụ trách: ${escapeHtml(data.assignedRole)} (${escapeHtml(roleName(data.assignedRole))})`,
    mentionLine,
    `⏰ Deadline: ${formatDeadline(data.deadline)}`,
    url ? `🔗 <a href="${url}/dashboard/tasks/${data.taskId}">Xem chi tiết</a>` : '',
  ].filter(Boolean).join('\n')
  await sendGroupMessage(msg)
}

// ── Task Assigned (L1→L2) → Group notification + tag ────────

export async function notifyTaskAssigned(data: {
  assignedUser: MentionUser
  assignedByName: string
  stepCode: string
  stepName: string
  projectCode: string
  projectName: string
  deadline: Date | null
  taskId: string
}): Promise<void> {
  const url = appUrl()
  const tag = data.assignedUser.telegramChatId
    ? mention(data.assignedUser.telegramChatId, data.assignedUser.fullName)
    : `<b>${escapeHtml(data.assignedUser.fullName)}</b>`

  const msg = [
    '📌 <b>PHÂN CÔNG CÔNG VIỆC</b>',
    '━━━━━━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `🔧 Công việc: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `👤 Giao cho: ${tag}`,
    `📝 Phân công bởi: ${escapeHtml(data.assignedByName)}`,
    `⏰ Deadline: <b>${formatDeadline(data.deadline)}</b>`,
    url ? `🔗 <a href="${url}/dashboard/tasks/${data.taskId}">Xem chi tiết</a>` : '',
  ].filter(Boolean).join('\n')
  await sendGroupMessage(msg)
}

// ── Task Rejected → Group notification ──────────────────────

export async function notifyTaskRejected(data: TaskNotifyData & {
  reason: string
  returnedTo: string
  returnedStepName: string
}): Promise<void> {
  const msg = [
    '⚠️ <b>CÔNG VIỆC BỊ TỪ CHỐI</b>',
    '━━━━━━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `❌ Lý do: ${escapeHtml(data.reason)}`,
    `🔄 Quay về: ${escapeHtml(data.returnedTo)} (${escapeHtml(data.returnedStepName)})`,
  ].join('\n')
  await sendGroupMessage(msg)
}

// ── Task Overdue → Group notification ───────────────────────

export async function notifyTaskOverdue(data: {
  stepCode: string
  stepName: string
  projectCode: string
  projectName: string
  assignedRole: string
  hoursOverdue: number
}): Promise<void> {
  const emoji = data.hoursOverdue > 48 ? '🚨' : '⏰'
  const label = data.hoursOverdue > 48 ? 'LEO THANG — QUÁ HẠN NGHIÊM TRỌNG' : 'CẢNH BÁO QUÁ HẠN'
  const msg = [
    `${emoji} <b>${label}</b>`,
    '━━━━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `⏰ Quá hạn: <b>${data.hoursOverdue} giờ</b>`,
    `👤 Phụ trách: ${escapeHtml(data.assignedRole)} (${escapeHtml(roleName(data.assignedRole))})`,
  ].join('\n')
  await sendGroupMessage(msg)
}

// ── Task Completed → Group notification (optional) ──────────

export async function notifyTaskCompleted(data: {
  stepCode: string
  stepName: string
  projectCode: string
  projectName: string
  completedBy: string
}): Promise<void> {
  const msg = [
    '✅ <b>HOÀN THÀNH</b>',
    '━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `👤 Hoàn thành bởi: ${escapeHtml(data.completedBy)}`,
  ].join('\n')
  await sendGroupMessage(msg)
}
