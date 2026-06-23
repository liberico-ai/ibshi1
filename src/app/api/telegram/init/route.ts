import { NextRequest } from 'next/server'
import { startPolling, isPolling } from '@/lib/telegram'
import { startScheduler, isSchedulerRunning } from '@/lib/cron-scheduler'
import { runDailyDigest } from '@/lib/cron-jobs'
import { authenticateRequest } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret')
  const expectedSecret = process.env.CRON_SECRET
  let authorized = false

  if (expectedSecret && cronSecret === expectedSecret) {
    authorized = true
  } else {
    const user = await authenticateRequest(req)
    if (user && ['R01', 'R10'].includes(user.roleCode)) {
      authorized = true
    }
  }

  if (!authorized) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

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
  if (trigger === 'digest') {
    console.log('[TelegramInit] Manual trigger: daily digest')
    try {
      const result = await runDailyDigest()
      console.log('[TelegramInit] Manual trigger result:', JSON.stringify(result))
      return Response.json({ ok: true, bot: botStatus, cron: 'running', triggered: result })
    } catch (err) {
      console.error('[TelegramInit] Manual trigger failed:', err)
      return Response.json({ ok: false, error: 'Digest failed' }, { status: 500 })
    }
  }

  return Response.json({ ok: true, bot: botStatus, cron: isSchedulerRunning() ? 'running' : 'failed' })
}
