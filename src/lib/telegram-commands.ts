// ══════════════════════════════════════════════════════════════
// Telegram Bot Commands — /help, /mytasks, /status, /overdue, etc.
// Registered with grammy Bot instance via registerCommands()
// ══════════════════════════════════════════════════════════════

import { Bot, Context } from 'grammy'
import prisma from '@/lib/db'
import { ROLES } from '@/lib/constants'
import { WORKFLOW_RULES, PHASE_LABELS } from '@/lib/workflow-constants'
import { escapeHtml, formatDeadline } from '@/lib/telegram'

// ── Command menu (registered with Telegram) ─────────────────

const COMMAND_LIST = [
  { command: 'help', description: 'Danh sách tất cả lệnh' },
  { command: 'start', description: 'Khởi động bot' },
  { command: 'link', description: 'Liên kết tài khoản ERP: /link <username>' },
  { command: 'unlink', description: 'Hủy liên kết tài khoản' },
  { command: 'mytasks', description: 'Công việc đang chờ tôi' },
  { command: 'status', description: 'Tiến độ dự án: /status <mã_DA>' },
  { command: 'overdue', description: 'Danh sách task quá hạn' },
  { command: 'phase', description: 'Chi tiết phase: /phase <mã_DA> <1-6>' },
  { command: 'project', description: 'Thông tin dự án: /project <mã_DA>' },
  { command: 'search', description: 'Tìm dự án: /search <từ_khóa>' },
  { command: 'report', description: 'Báo cáo tổng hợp toàn công ty' },
  { command: 'whois', description: 'Ai giữ role: /whois <mã_role>' },
  { command: 'deadline', description: 'Deadline sắp tới: /deadline <mã_DA>' },
]

// ── Helper: resolve Telegram chatId → ERP user ──────────────

async function resolveUser(chatId: number) {
  return prisma.user.findUnique({
    where: { telegramChatId: String(chatId) },
    select: { id: true, username: true, fullName: true, roleCode: true },
  })
}

function roleName(code: string): string {
  return (ROLES as Record<string, { name: string }>)[code]?.name || code
}

function progressBar(pct: number, length = 12): string {
  const filled = Math.round((pct / 100) * length)
  return '█'.repeat(filled) + '░'.repeat(length - filled)
}

function statusEmoji(status: string): string {
  if (status === 'DONE') return '✅'
  if (status === 'IN_PROGRESS') return '🔵'
  if (status === 'REJECTED') return '🔴'
  return '⚪'
}

// ══════════════════════════════════════════════════════════════
// Register all commands with the Bot instance
// ══════════════════════════════════════════════════════════════

export function registerCommands(bot: Bot): void {
  bot.api.setMyCommands(COMMAND_LIST).catch(console.error)

  // ── /start ──────────────────────────────────────────────
  bot.command('start', async (ctx: Context) => {
    await ctx.reply(
      '👋 Xin chào! Tôi là trợ lý <b>IBS-ERP</b>.\n\n' +
      '🔗 Dùng /link &lt;username&gt; để liên kết tài khoản ERP.\n' +
      '📖 Dùng /help để xem danh sách lệnh.',
      { parse_mode: 'HTML' },
    )
  })

  // ── /help ───────────────────────────────────────────────
  bot.command('help', async (ctx: Context) => {
    const lines = COMMAND_LIST.map(c => `/${c.command} — ${c.description}`)
    await ctx.reply(
      '📖 <b>DANH SÁCH LỆNH</b>\n━━━━━━━━━━━━━━━━\n' + lines.join('\n'),
      { parse_mode: 'HTML' },
    )
  })

  // ── /link <username> ────────────────────────────────────
  bot.command('link', async (ctx: Context) => {
    const username = ctx.match?.toString().trim()
    if (!username) {
      await ctx.reply('Cú pháp: /link <username>\nVí dụ: /link giangdd')
      return
    }
    const chatId = String(ctx.from!.id)

    // Check if this Telegram account is already linked
    const existing = await prisma.user.findUnique({ where: { telegramChatId: chatId } })
    if (existing) {
      await ctx.reply(`Tài khoản Telegram đã liên kết với <b>${escapeHtml(existing.fullName)}</b> (${existing.username}).\nDùng /unlink trước nếu muốn đổi.`, { parse_mode: 'HTML' })
      return
    }

    // Find ERP user by username (case-insensitive)
    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true, username: true, fullName: true, roleCode: true, telegramChatId: true },
    })
    if (!user) {
      await ctx.reply(`Không tìm thấy user "${escapeHtml(username)}" trong hệ thống ERP.`, { parse_mode: 'HTML' })
      return
    }
    if (user.telegramChatId) {
      await ctx.reply(`Username <b>${escapeHtml(user.username)}</b> đã được liên kết với tài khoản Telegram khác.`, { parse_mode: 'HTML' })
      return
    }

    await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: chatId } })
    await ctx.reply(
      `✅ Đã liên kết thành công!\n👤 ${escapeHtml(user.fullName)} (${escapeHtml(user.username)})\n🏷️ Role: ${escapeHtml(user.roleCode)} — ${escapeHtml(roleName(user.roleCode))}`,
      { parse_mode: 'HTML' },
    )
  })

  // ── /unlink ─────────────────────────────────────────────
  bot.command('unlink', async (ctx: Context) => {
    const chatId = String(ctx.from!.id)
    const user = await prisma.user.findUnique({ where: { telegramChatId: chatId } })
    if (!user) {
      await ctx.reply('Bạn chưa liên kết tài khoản ERP nào. Dùng /link <username> để liên kết.')
      return
    }
    await prisma.user.update({ where: { telegramChatId: chatId }, data: { telegramChatId: null } })
    await ctx.reply(`✅ Đã hủy liên kết tài khoản <b>${escapeHtml(user.fullName)}</b>.`, { parse_mode: 'HTML' })
  })

  // ── /mytasks ────────────────────────────────────────────
  bot.command('mytasks', async (ctx: Context) => {
    const user = await resolveUser(ctx.from!.id)
    if (!user) {
      await ctx.reply('Chưa liên kết tài khoản. Dùng /link <username> để liên kết.')
      return
    }

    const tasks = await prisma.workflowTask.findMany({
      where: {
        OR: [
          { assignedTo: user.id },
          { assignedRole: user.roleCode, assignedTo: null },
        ],
        status: 'IN_PROGRESS',
      },
      include: {
        project: { select: { projectCode: true, projectName: true } },
      },
      orderBy: [{ deadline: 'asc' }, { createdAt: 'asc' }],
      take: 15,
    })

    if (tasks.length === 0) {
      await ctx.reply(`✅ Không có công việc nào đang chờ bạn, <b>${escapeHtml(user.fullName)}</b>!`, { parse_mode: 'HTML' })
      return
    }

    const lines = tasks.map((t, i) => {
      const dl = t.deadline ? formatDeadline(t.deadline) : '—'
      return `${i + 1}. <b>${escapeHtml(t.stepCode)}</b> ${escapeHtml(t.stepName)}\n   📁 ${escapeHtml(t.project.projectCode)} ⏰ ${dl}`
    })

    // Count total if more than 15
    const total = await prisma.workflowTask.count({
      where: {
        OR: [
          { assignedTo: user.id },
          { assignedRole: user.roleCode, assignedTo: null },
        ],
        status: 'IN_PROGRESS',
      },
    })

    let msg = `📋 <b>CÔNG VIỆC CỦA ${escapeHtml(user.fullName.toUpperCase())}</b>\n━━━━━━━━━━━━━━━━\n` + lines.join('\n')
    if (total > 15) msg += `\n\n... và ${total - 15} task nữa`
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /status <projectCode> ──────────────────────────────
  bot.command('status', async (ctx: Context) => {
    const code = ctx.match?.toString().trim()
    if (!code) {
      await ctx.reply('Cú pháp: /status <mã_dự_án>\nVí dụ: /status PRJ-2026-001')
      return
    }

    const project = await prisma.project.findFirst({
      where: { projectCode: { equals: code, mode: 'insensitive' } },
      include: {
        tasks: { select: { stepCode: true, status: true, stepName: true } },
      },
    })
    if (!project) {
      await ctx.reply(`Không tìm thấy dự án "${escapeHtml(code)}".`, { parse_mode: 'HTML' })
      return
    }

    // Group by phase
    const phaseStats: Record<number, { total: number; done: number; inProgress: string[] }> = {}
    for (const t of project.tasks) {
      const r = WORKFLOW_RULES[t.stepCode]
      const p = r?.phase || 0
      if (!phaseStats[p]) phaseStats[p] = { total: 0, done: 0, inProgress: [] }
      phaseStats[p].total++
      if (t.status === 'DONE') phaseStats[p].done++
      if (t.status === 'IN_PROGRESS') phaseStats[p].inProgress.push(t.stepCode)
    }

    const totalDone = project.tasks.filter(t => t.status === 'DONE').length
    const totalTasks = project.tasks.length
    const overallPct = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0
    const activeSteps = project.tasks.filter(t => t.status === 'IN_PROGRESS').map(t => t.stepCode)

    const phaseLines = Object.entries(phaseStats)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([phase, s]) => {
        const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
        const label = PHASE_LABELS[Number(phase)]?.name || `Phase ${phase}`
        return `P${phase} ${label.padEnd(14)} ${progressBar(pct)} ${String(pct).padStart(3)}%  ${s.done}/${s.total}`
      })

    const msg = [
      `📊 <b>TIẾN ĐỘ: ${escapeHtml(project.projectCode)}</b>`,
      `📁 ${escapeHtml(project.projectName)}`,
      '━━━━━━━━━━━━━━━━━━',
      `<code>${phaseLines.join('\n')}</code>`,
      '',
      `📈 Tổng: <b>${totalDone}/${totalTasks}</b> (${overallPct}%)`,
      activeSteps.length > 0 ? `🔄 Đang XL: ${activeSteps.join(', ')}` : '✅ Không có task đang xử lý',
    ].join('\n')
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /overdue ────────────────────────────────────────────
  bot.command('overdue', async (ctx: Context) => {
    const now = new Date()
    const tasks = await prisma.workflowTask.findMany({
      where: { status: 'IN_PROGRESS', deadline: { lt: now } },
      include: {
        project: { select: { projectCode: true, projectName: true } },
      },
      orderBy: { deadline: 'asc' },
      take: 20,
    })

    if (tasks.length === 0) {
      await ctx.reply('✅ Không có task nào quá hạn!')
      return
    }

    const total = await prisma.workflowTask.count({
      where: { status: 'IN_PROGRESS', deadline: { lt: now } },
    })

    const lines = tasks.map((t) => {
      const hours = Math.round((now.getTime() - new Date(t.deadline!).getTime()) / 3600000)
      const emoji = hours > 48 ? '🚨' : '⏰'
      return `${emoji} <b>${escapeHtml(t.stepCode)}</b> — ${escapeHtml(t.stepName)}\n   📁 ${escapeHtml(t.project.projectCode)} | ${escapeHtml(t.assignedRole)} | Quá hạn: ${hours}h`
    })

    let msg = `⏰ <b>TASK QUÁ HẠN (${total})</b>\n━━━━━━━━━━━━━━━━\n` + lines.join('\n')
    if (total > 20) msg += `\n\n... và ${total - 20} task nữa`
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /project <code> ─────────────────────────────────────
  bot.command('project', async (ctx: Context) => {
    const code = ctx.match?.toString().trim()
    if (!code) {
      await ctx.reply('Cú pháp: /project <mã_dự_án>\nVí dụ: /project PRJ-2026-001')
      return
    }

    const project = await prisma.project.findFirst({
      where: { projectCode: { equals: code, mode: 'insensitive' } },
      include: {
        tasks: { select: { status: true } },
      },
    })
    if (!project) {
      await ctx.reply(`Không tìm thấy dự án "${escapeHtml(code)}".`, { parse_mode: 'HTML' })
      return
    }

    const done = project.tasks.filter(t => t.status === 'DONE').length
    const inProgress = project.tasks.filter(t => t.status === 'IN_PROGRESS').length
    const total = project.tasks.length
    const pct = total > 0 ? Math.round((done / total) * 100) : 0

    const msg = [
      `📁 <b>DỰ ÁN: ${escapeHtml(project.projectCode)}</b>`,
      '━━━━━━━━━━━━━━━━',
      `📌 Tên: ${escapeHtml(project.projectName)}`,
      `🏢 Khách hàng: ${escapeHtml(project.clientName)}`,
      `📦 Loại SP: ${escapeHtml(project.productType)}`,
      `💰 Giá trị HĐ: ${project.contractValue ? Number(project.contractValue).toLocaleString('vi-VN') + ' ' + project.currency : '—'}`,
      `📅 Bắt đầu: ${project.startDate ? formatDeadline(project.startDate) : '—'}`,
      `📅 Kết thúc: ${project.endDate ? formatDeadline(project.endDate) : '—'}`,
      `📊 Trạng thái: ${escapeHtml(project.status)}`,
      `📈 Tiến độ: ${progressBar(pct)} ${pct}% (${done}/${total})`,
      `🔄 Đang XL: ${inProgress} task`,
    ].join('\n')
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /phase <code> <1-6> ─────────────────────────────────
  bot.command('phase', async (ctx: Context) => {
    const args = ctx.match?.toString().trim().split(/\s+/) || []
    if (args.length < 2) {
      await ctx.reply('Cú pháp: /phase <mã_dự_án> <1-6>\nVí dụ: /phase PRJ-2026-001 4')
      return
    }
    const [code, phaseStr] = args
    const phaseNum = parseInt(phaseStr)
    if (isNaN(phaseNum) || phaseNum < 1 || phaseNum > 6) {
      await ctx.reply('Phase phải từ 1 đến 6.')
      return
    }

    const project = await prisma.project.findFirst({
      where: { projectCode: { equals: code, mode: 'insensitive' } },
      include: {
        tasks: {
          select: { stepCode: true, stepName: true, status: true, assignedRole: true, deadline: true },
        },
      },
    })
    if (!project) {
      await ctx.reply(`Không tìm thấy dự án "${escapeHtml(code)}".`, { parse_mode: 'HTML' })
      return
    }

    const phaseTasks = project.tasks.filter(t => WORKFLOW_RULES[t.stepCode]?.phase === phaseNum)
    if (phaseTasks.length === 0) {
      await ctx.reply(`Phase ${phaseNum} không có task nào.`)
      return
    }

    const phaseName = PHASE_LABELS[phaseNum]?.name || `Phase ${phaseNum}`
    const done = phaseTasks.filter(t => t.status === 'DONE').length

    const lines = phaseTasks.map(t => {
      const dl = t.deadline ? formatDeadline(t.deadline) : '—'
      return `${statusEmoji(t.status)} <b>${escapeHtml(t.stepCode)}</b> ${escapeHtml(t.stepName)}\n   👤 ${escapeHtml(t.assignedRole)} ⏰ ${dl}`
    })

    const msg = [
      `📋 <b>P${phaseNum} — ${escapeHtml(phaseName)}</b>`,
      `📁 ${escapeHtml(project.projectCode)} — ${escapeHtml(project.projectName)}`,
      `📊 ${done}/${phaseTasks.length} hoàn thành`,
      '━━━━━━━━━━━━━━━━',
      ...lines,
    ].join('\n')
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /search <keyword> ───────────────────────────────────
  bot.command('search', async (ctx: Context) => {
    const keyword = ctx.match?.toString().trim()
    if (!keyword) {
      await ctx.reply('Cú pháp: /search <từ_khóa>\nVí dụ: /search tháp nén')
      return
    }

    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { projectCode: { contains: keyword, mode: 'insensitive' } },
          { projectName: { contains: keyword, mode: 'insensitive' } },
          { clientName: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      include: { tasks: { select: { status: true } } },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    })

    if (projects.length === 0) {
      await ctx.reply(`Không tìm thấy dự án nào với từ khóa "${escapeHtml(keyword)}".`, { parse_mode: 'HTML' })
      return
    }

    const lines = projects.map(p => {
      const done = p.tasks.filter(t => t.status === 'DONE').length
      const pct = p.tasks.length > 0 ? Math.round((done / p.tasks.length) * 100) : 0
      return `📁 <b>${escapeHtml(p.projectCode)}</b> — ${escapeHtml(p.projectName)}\n   🏢 ${escapeHtml(p.clientName)} | ${p.status} | ${pct}%`
    })

    const msg = `🔍 <b>KẾT QUẢ TÌM KIẾM: "${escapeHtml(keyword)}"</b>\n━━━━━━━━━━━━━━━━\n` + lines.join('\n')
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /whois <roleCode> ──────────────────────────────────
  bot.command('whois', async (ctx: Context) => {
    const code = ctx.match?.toString().trim().toUpperCase()
    if (!code) {
      const roleList = Object.entries(ROLES).map(([k, v]) => `${k} — ${(v as { name: string }).name}`).join('\n')
      await ctx.reply(`Cú pháp: /whois <mã_role>\nVí dụ: /whois R05\n\n<b>Danh sách role:</b>\n<code>${roleList}</code>`, { parse_mode: 'HTML' })
      return
    }

    const users = await prisma.user.findMany({
      where: { roleCode: { equals: code, mode: 'insensitive' }, isActive: true },
      select: { fullName: true, username: true, roleCode: true },
      orderBy: { fullName: 'asc' },
    })

    if (users.length === 0) {
      await ctx.reply(`Không có user nào với role "${escapeHtml(code)}".`, { parse_mode: 'HTML' })
      return
    }

    const rn = roleName(code)
    const lines = users.map((u, i) => `${i + 1}. ${escapeHtml(u.fullName)} (<code>${escapeHtml(u.username)}</code>)`)
    const msg = `👤 <b>${escapeHtml(code)} — ${escapeHtml(rn)}</b> (${users.length} người)\n━━━━━━━━━━━━━━━━\n` + lines.join('\n')
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /deadline <projectCode> ─────────────────────────────
  bot.command('deadline', async (ctx: Context) => {
    const code = ctx.match?.toString().trim()
    if (!code) {
      await ctx.reply('Cú pháp: /deadline <mã_dự_án>\nVí dụ: /deadline PRJ-2026-001')
      return
    }

    const project = await prisma.project.findFirst({
      where: { projectCode: { equals: code, mode: 'insensitive' } },
      select: { id: true, projectCode: true, projectName: true },
    })
    if (!project) {
      await ctx.reply(`Không tìm thấy dự án "${escapeHtml(code)}".`, { parse_mode: 'HTML' })
      return
    }

    const tasks = await prisma.workflowTask.findMany({
      where: { projectId: project.id, status: 'IN_PROGRESS', deadline: { not: null } },
      select: { stepCode: true, stepName: true, deadline: true, assignedRole: true },
      orderBy: { deadline: 'asc' },
    })

    if (tasks.length === 0) {
      await ctx.reply(`Không có task đang xử lý nào có deadline cho dự án ${escapeHtml(project.projectCode)}.`, { parse_mode: 'HTML' })
      return
    }

    const now = new Date()
    const lines = tasks.map(t => {
      const dl = new Date(t.deadline!)
      const diffH = Math.round((dl.getTime() - now.getTime()) / 3600000)
      let countdown: string
      let emoji: string
      if (diffH < 0) {
        countdown = `<b>Quá hạn ${Math.abs(diffH)}h</b>`
        emoji = '🔴'
      } else if (diffH <= 72) {
        countdown = `Còn ${diffH}h`
        emoji = '🟡'
      } else {
        const days = Math.round(diffH / 24)
        countdown = `Còn ${days} ngày`
        emoji = '🟢'
      }
      return `${emoji} <b>${escapeHtml(t.stepCode)}</b> ${escapeHtml(t.stepName)}\n   👤 ${escapeHtml(t.assignedRole)} | ${formatDeadline(t.deadline)} (${countdown})`
    })

    const msg = [
      `⏰ <b>DEADLINE: ${escapeHtml(project.projectCode)}</b>`,
      `📁 ${escapeHtml(project.projectName)}`,
      '━━━━━━━━━━━━━━━━',
      ...lines,
    ].join('\n')
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })

  // ── /report ─────────────────────────────────────────────
  bot.command('report', async (ctx: Context) => {
    const [projects, overdueTasks] = await Promise.all([
      prisma.project.findMany({
        where: { status: 'ACTIVE' },
        include: { tasks: { select: { status: true, deadline: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.workflowTask.count({
        where: { status: 'IN_PROGRESS', deadline: { lt: new Date() } },
      }),
    ])

    const totalActive = projects.length
    const totalOverdue = overdueTasks

    const projectLines = projects.map(p => {
      const done = p.tasks.filter(t => t.status === 'DONE').length
      const pct = p.tasks.length > 0 ? Math.round((done / p.tasks.length) * 100) : 0
      const od = p.tasks.filter(t => t.status === 'IN_PROGRESS' && t.deadline && new Date(t.deadline) < new Date()).length
      const odTag = od > 0 ? ` ⚠️${od}` : ''
      return `  ${progressBar(pct, 8)} ${String(pct).padStart(3)}% <b>${escapeHtml(p.projectCode)}</b>${odTag}`
    })

    const msg = [
      '📊 <b>BÁO CÁO TỔNG HỢP</b>',
      '━━━━━━━━━━━━━━━━',
      `📁 Dự án đang hoạt động: <b>${totalActive}</b>`,
      `⏰ Task quá hạn: <b>${totalOverdue}</b>`,
      '',
      '<b>Top dự án:</b>',
      ...projectLines,
    ].join('\n')
    await ctx.reply(msg, { parse_mode: 'HTML' })
  })
}
