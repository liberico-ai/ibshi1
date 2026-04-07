// ══════════════════════════════════════════════════════════════
// Next.js Instrumentation — runs once when the server starts
// Starts Telegram bot polling (backup — Docker CMD also triggers init endpoint)
// ══════════════════════════════════════════════════════════════

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Delay to let the server + DB fully initialize
    // Bot token can be in env OR in database (SystemConfig)
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
