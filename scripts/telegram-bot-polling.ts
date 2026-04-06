/**
 * Telegram Bot — Polling Mode (for local development)
 *
 * Usage: npx tsx scripts/telegram-bot-polling.ts
 *
 * This runs the bot in long-polling mode (no webhook needed).
 * Use this when the server is not publicly accessible (localhost).
 * For production with public URL, use webhook via /api/telegram/setup instead.
 */

import 'dotenv/config'
import { Bot } from 'grammy'

// Dynamically import to use path aliases
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not set in .env')
    process.exit(1)
  }

  const bot = new Bot(token)

  // Register commands using the same logic as the main app
  const { registerCommands } = await import('../src/lib/telegram-commands')
  registerCommands(bot)

  // Delete any existing webhook so polling works
  await bot.api.deleteWebhook()

  console.log('🤖 IBS-ERP Telegram Bot started (polling mode)')
  console.log(`   Bot: @${(await bot.api.getMe()).username}`)
  console.log(`   Group: ${process.env.TELEGRAM_GROUP_CHAT_ID || 'not set'}`)
  console.log('   Press Ctrl+C to stop\n')

  bot.start({
    onStart: () => console.log('✅ Bot is listening for messages...'),
  })
}

main().catch(err => {
  console.error('Bot startup error:', err)
  process.exit(1)
})
