// ══════════════════════════════════════════════════════════════
// Next.js Instrumentation — runs once when the server starts
// Used to start the Telegram bot in polling mode
// ══════════════════════════════════════════════════════════════

export async function register() {
  // Only run in Node.js runtime, not Edge
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await startTelegramBot()
  }
}

async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  try {
    const { getBot } = await import('@/lib/telegram')
    const bot = getBot()
    if (!bot) return

    // Remove any existing webhook so polling works
    await bot.api.deleteWebhook()

    // Start long-polling (non-blocking, runs in background)
    bot.start({
      onStart: (info) =>
        console.log(`🤖 Telegram bot @${info.username} started (polling mode)`),
    })

    // Graceful shutdown
    const stop = () => {
      bot.stop()
      console.log('🤖 Telegram bot stopped')
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  } catch (err) {
    // Non-fatal — server continues even if bot fails
    console.error('Telegram bot startup error:', err)
  }
}
