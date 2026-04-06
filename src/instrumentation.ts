// ══════════════════════════════════════════════════════════════
// Next.js Instrumentation — runs once when the server starts
// Used to start the Telegram bot in polling mode
// ══════════════════════════════════════════════════════════════

export async function register() {
  // Only run in Node.js runtime, not Edge
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    startTelegramBot()
  }
}

function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  // Delay bot start slightly to let the server fully initialize
  setTimeout(async () => {
    try {
      const { getBot } = await import('@/lib/telegram')
      const bot = getBot()
      if (!bot) {
        console.log('🤖 Telegram bot: no bot instance (token missing?)')
        return
      }

      console.log('🤖 Telegram bot: deleting webhook...')
      await bot.api.deleteWebhook()

      console.log('🤖 Telegram bot: starting polling...')
      await bot.start({
        onStart: (info) =>
          console.log(`🤖 Telegram bot @${info.username} polling active`),
      })
    } catch (err) {
      console.error('🤖 Telegram bot error:', err)
      // Retry after 30s if initial start fails
      setTimeout(() => startTelegramBot(), 30_000)
    }
  }, 3_000)

  // Graceful shutdown
  const stop = async () => {
    try {
      const { getBot } = await import('@/lib/telegram')
      const bot = getBot()
      bot?.stop()
      console.log('🤖 Telegram bot stopped')
    } catch { /* ignore */ }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
