// ══════════════════════════════════════════════════════════════
// Telegram Bot Service — Core library for IBS-ERP integration
// Wraps grammy Bot instance + message sending helpers
// ══════════════════════════════════════════════════════════════

import { Bot } from 'grammy'
import prisma from '@/lib/db'
import { registerCommands } from '@/lib/telegram-commands'

// ── Singleton Bot instance (lazy init) ──────────────────────

let botInstance: Bot | null = null
let pollingActive = false

export function getBot(): Bot | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null
  if (!botInstance) {
    botInstance = new Bot(process.env.TELEGRAM_BOT_TOKEN)
    registerCommands(botInstance)
  }
  return botInstance
}

// ── Start polling (called once from init endpoint) ─────────

export async function startPolling(): Promise<boolean> {
  if (pollingActive) return true
  const bot = getBot()
  if (!bot) return false

  try {
    await bot.api.deleteWebhook()
    pollingActive = true
    bot.start({
      onStart: (info) => console.log(`🤖 Bot @${info.username} polling active`),
    }).catch(err => {
      console.error('🤖 Bot polling error:', err)
      pollingActive = false
    })
    return true
  } catch (err) {
    console.error('🤖 Bot start error:', err)
    return false
  }
}

export function isPolling(): boolean {
  return pollingActive
}

// ── Group chat ID from env var ──────────────────────────────

export function getGroupChatId(): string | null {
  return process.env.TELEGRAM_GROUP_CHAT_ID || null
}

// ── Send message to company group ───────────────────────────

export async function sendGroupMessage(text: string): Promise<void> {
  const bot = getBot()
  if (!bot) return
  const chatId = getGroupChatId()
  if (!chatId) return
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Telegram sendGroupMessage error:', err)
  }
}

// ── Send DM to a user (by ERP user ID) ─────────────────────

export async function sendDirectMessage(userId: string, text: string): Promise<void> {
  const bot = getBot()
  if (!bot) return
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true },
  })
  if (!user?.telegramChatId) return
  try {
    await bot.api.sendMessage(user.telegramChatId, text, { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Telegram sendDM error:', err)
  }
}

// ── Format helpers ──────────────────────────────────────────

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function formatDeadline(deadline: Date | null): string {
  if (!deadline) return 'Không có'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(deadline))
}
