// ══════════════════════════════════════════════════════════════
// Telegram Bot Service — Core library for IBS-ERP integration
// Wraps grammy Bot instance + message sending helpers
// Config: reads from DB (SystemConfig) with env fallback + cache
// ══════════════════════════════════════════════════════════════

import { Bot } from 'grammy'
import prisma from '@/lib/db'
import { registerCommands } from '@/lib/telegram-commands'
import { decrypt } from '@/lib/encryption'

// ── Config from DB with env fallback ───────────────────────

interface TelegramConfig {
  botToken: string | null
  webhookSecret: string | null
  groupChatId: string | null
}

let configCache: TelegramConfig | null = null
let configCacheTime = 0
const CONFIG_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function getTelegramConfig(): Promise<TelegramConfig> {
  const now = Date.now()
  if (configCache && now - configCacheTime < CONFIG_CACHE_TTL) {
    return configCache
  }

  try {
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: ['telegram_bot_token', 'telegram_webhook_secret', 'telegram_group_chat_id'] } },
    })

    const dbValues: Record<string, string> = {}
    for (const c of configs) {
      if (c.key === 'telegram_bot_token' || c.key === 'telegram_webhook_secret') {
        try { dbValues[c.key] = decrypt(c.value) } catch { /* decrypt failed, skip */ }
      } else {
        dbValues[c.key] = c.value
      }
    }

    configCache = {
      botToken: dbValues.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || null,
      webhookSecret: dbValues.telegram_webhook_secret || process.env.TELEGRAM_WEBHOOK_SECRET || null,
      groupChatId: dbValues.telegram_group_chat_id || process.env.TELEGRAM_GROUP_CHAT_ID || null,
    }
  } catch {
    // DB unavailable — fall back to env
    configCache = {
      botToken: process.env.TELEGRAM_BOT_TOKEN || null,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
      groupChatId: process.env.TELEGRAM_GROUP_CHAT_ID || null,
    }
  }

  configCacheTime = now
  return configCache
}

export function invalidateConfigCache(): void {
  configCache = null
  configCacheTime = 0
}

// ── Singleton Bot instance (lazy init from config) ─────────

let botInstance: Bot | null = null
let currentBotToken: string | null = null
let pollingActive = false

export async function getBot(): Promise<Bot | null> {
  const config = await getTelegramConfig()
  if (!config.botToken) return null

  // If token changed, rebuild the bot
  if (botInstance && currentBotToken !== config.botToken) {
    try { botInstance.stop() } catch { /* ignore */ }
    botInstance = null
    pollingActive = false
  }

  if (!botInstance) {
    botInstance = new Bot(config.botToken)
    currentBotToken = config.botToken
    registerCommands(botInstance)
  }
  return botInstance
}

// ── Start polling (called once from init endpoint) ─────────

export async function startPolling(): Promise<boolean> {
  if (pollingActive) return true
  const bot = await getBot()
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

// ── Reset bot (after config change) ────────────────────────

export async function resetBot(): Promise<void> {
  if (botInstance) {
    try { botInstance.stop() } catch { /* ignore */ }
    botInstance = null
    currentBotToken = null
    pollingActive = false
  }
  invalidateConfigCache()
}

// ── Group chat ID from config ──────────────────────────────

export async function getGroupChatId(): Promise<string | null> {
  const config = await getTelegramConfig()
  return config.groupChatId
}

// ── Webhook secret from config ─────────────────────────────

export async function getWebhookSecret(): Promise<string | null> {
  const config = await getTelegramConfig()
  return config.webhookSecret
}

// ── Send message to company group ───────────────────────────

export async function sendGroupMessage(text: string): Promise<void> {
  const bot = await getBot()
  if (!bot) { console.warn('🤖 sendGroupMessage: no bot (token missing)'); return }
  const chatId = await getGroupChatId()
  if (!chatId) { console.warn('🤖 sendGroupMessage: no groupChatId'); return }
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Telegram sendGroupMessage error:', err)
  }
}

// ── Send DM to a user (by ERP user ID) ─────────────────────

export async function sendDirectMessage(userId: string, text: string): Promise<void> {
  const bot = await getBot()
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
