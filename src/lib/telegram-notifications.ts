// ══════════════════════════════════════════════════════════════
// Telegram Notification Formatters — Push to company group
// Called by workflow-engine.ts and deadline-check cron
// ALL calls are fire-and-forget — errors never block workflow
// ══════════════════════════════════════════════════════════════

import { sendGroupMessage, sendDirectMessage, escapeHtml, formatDeadline } from '@/lib/telegram'
import { ROLES } from '@/lib/constants'

// ── Shared helpers ──────────────────────────────────────────

function roleName(roleCode: string): string {
  return (ROLES as Record<string, { name: string }>)[roleCode]?.name || roleCode
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || ''
}

// ── Task Activated → Group notification ─────────────────────

interface TaskNotifyData {
  stepCode: string
  stepName: string
  projectCode: string
  projectName: string
  assignedRole: string
  deadline: Date | null
  taskId: string
}

export async function notifyTaskActivated(data: TaskNotifyData): Promise<void> {
  const url = appUrl()
  const msg = [
    '📋 <b>CÔNG VIỆC MỚI</b>',
    '━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `👤 Phụ trách: ${escapeHtml(data.assignedRole)} (${escapeHtml(roleName(data.assignedRole))})`,
    `⏰ Deadline: ${formatDeadline(data.deadline)}`,
    url ? `🔗 <a href="${url}/dashboard/tasks/${data.taskId}">Xem chi tiết</a>` : '',
  ].filter(Boolean).join('\n')
  await sendGroupMessage(msg)
}

// ── Task Assigned → DM to assigned user ─────────────────────

export async function notifyTaskAssigned(data: {
  userId: string
  assignedByName: string
  stepCode: string
  stepName: string
  projectCode: string
  projectName: string
  deadline: Date | null
  taskId: string
}): Promise<void> {
  const url = appUrl()
  const msg = [
    '📌 <b>BẠN ĐƯỢC PHÂN CÔNG VIỆC MỚI</b>',
    '━━━━━━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `🔧 Công việc: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `👤 Phân công bởi: ${escapeHtml(data.assignedByName)}`,
    `⏰ Deadline: <b>${formatDeadline(data.deadline)}</b>`,
    url ? `🔗 <a href="${url}/dashboard/tasks/${data.taskId}">Xem chi tiết</a>` : '',
  ].filter(Boolean).join('\n')
  await sendDirectMessage(data.userId, msg)
}

// ── Task Activated → DM to all role-matched users ───────────

export async function notifyUsersTaskActivated(data: TaskNotifyData & {
  userIds: string[]
}): Promise<void> {
  const url = appUrl()
  const msg = [
    '📋 <b>CÔNG VIỆC MỚI CHO BẠN</b>',
    '━━━━━━━━━━━━━━━━━━━━━',
    `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
    `🔧 Công việc: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
    `👤 Phụ trách: ${escapeHtml(data.assignedRole)} (${escapeHtml(roleName(data.assignedRole))})`,
    `⏰ Deadline: <b>${formatDeadline(data.deadline)}</b>`,
    url ? `🔗 <a href="${url}/dashboard/tasks/${data.taskId}">Xem chi tiết</a>` : '',
  ].filter(Boolean).join('\n')
  await Promise.allSettled(data.userIds.map(uid => sendDirectMessage(uid, msg)))
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
