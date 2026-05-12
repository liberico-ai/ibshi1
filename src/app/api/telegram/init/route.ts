import { startPolling, isPolling } from '@/lib/telegram'
import { startScheduler, isSchedulerRunning } from '@/lib/cron-scheduler'

export async function GET() {
  let botStatus = 'already_running'
  if (!isPolling()) {
    const started = await startPolling()
    botStatus = started ? 'started' : 'failed'
  }

  if (!isSchedulerRunning()) {
    startScheduler()
  }

  return Response.json({ ok: true, bot: botStatus, cron: isSchedulerRunning() ? 'running' : 'failed' })
}
