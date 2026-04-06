// ══════════════════════════════════════════════════════════════
// Next.js Instrumentation — runs once when the server starts
// Starts Telegram bot polling (backup — Docker CMD also triggers init endpoint)
// ══════════════════════════════════════════════════════════════

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.TELEGRAM_BOT_TOKEN) {
    // Delay to let the server fully initialize
    setTimeout(async () => {
      try {
        const { startPolling } = await import('@/lib/telegram')
        await startPolling()
      } catch (err) {
        console.error('🤖 Telegram instrumentation error:', err)
      }
    }, 3_000)
  }
}
