// ══════════════════════════════════════════════════════════════
// Next.js Instrumentation — runs once when the server starts
// Starts Telegram bot polling (backup — Docker CMD also triggers init endpoint)
// ══════════════════════════════════════════════════════════════

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Skip Telegram bot in local dev to avoid long-polling blocking the server
    if (process.env.SKIP_TELEGRAM === '1') {
      console.log('🤖 Telegram bot skipped (SKIP_TELEGRAM=1)')
      return
    }
    // Delay to let the server + DB fully initialize
    // Bot token can be in env OR in database (SystemConfig)
    setTimeout(async () => {
      try {
        const { startPolling } = await import('@/lib/telegram')
        await startPolling()
      } catch (err) {
        console.error('🤖 Telegram instrumentation error:', err)
      }
      try {
        const { startScheduler } = await import('@/lib/cron-scheduler')
        startScheduler()
      } catch (err) {
        console.error('📅 Cron scheduler instrumentation error:', err)
      }
    }, 3_000)
  }
}
