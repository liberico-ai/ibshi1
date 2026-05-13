import { NextRequest } from 'next/server'
import { startPolling, isPolling } from '@/lib/telegram'
import { startScheduler, isSchedulerRunning } from '@/lib/cron-scheduler'
import { runProjectStatusReport } from '@/lib/cron-jobs'

export async function GET(req: NextRequest) {
  console.log('[TelegramInit] GET called — bot:', isPolling(), 'cron:', isSchedulerRunning())

  let botStatus = 'already_running'
  if (!isPolling()) {
    console.log('[TelegramInit] Starting bot polling...')
    const started = await startPolling()
    botStatus = started ? 'started' : 'failed'
    console.log('[TelegramInit] Bot polling result:', botStatus)
  }

  if (!isSchedulerRunning()) {
    console.log('[TelegramInit] Starting cron scheduler...')
    startScheduler()
    console.log('[TelegramInit] Cron scheduler after start:', isSchedulerRunning())
  }

  const trigger = req.nextUrl.searchParams.get('trigger')
  if (trigger === 'status-report') {
    console.log('[TelegramInit] Manual trigger: status-report')
    try {
      const result = await runProjectStatusReport()
      console.log('[TelegramInit] Manual trigger result:', JSON.stringify(result))
      return Response.json({ ok: true, bot: botStatus, cron: 'running', triggered: result })
    } catch (err) {
      console.error('[TelegramInit] Manual trigger failed:', err)
      return Response.json({ ok: false, error: 'Report failed', detail: String(err) }, { status: 500 })
    }
  }

  return Response.json({ ok: true, bot: botStatus, cron: isSchedulerRunning() ? 'running' : 'failed' })
}
