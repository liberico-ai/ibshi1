import { NextRequest } from 'next/server'
import { startPolling, isPolling } from '@/lib/telegram'
import { startScheduler, isSchedulerRunning } from '@/lib/cron-scheduler'
import { runProjectStatusReport } from '@/lib/cron-jobs'

export async function GET(req: NextRequest) {
  let botStatus = 'already_running'
  if (!isPolling()) {
    const started = await startPolling()
    botStatus = started ? 'started' : 'failed'
  }

  if (!isSchedulerRunning()) {
    startScheduler()
  }

  const trigger = req.nextUrl.searchParams.get('trigger')
  if (trigger === 'status-report') {
    const result = await runProjectStatusReport()
    return Response.json({ ok: true, bot: botStatus, cron: 'running', triggered: result })
  }

  return Response.json({ ok: true, bot: botStatus, cron: isSchedulerRunning() ? 'running' : 'failed' })
}
