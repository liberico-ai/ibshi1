import cron from 'node-cron'
import { runDailyDigest } from '@/lib/cron-jobs'

let initialized = false

export function isSchedulerRunning() {
  return initialized
}

export function startScheduler() {
  if (initialized) {
    console.log('[CronScheduler] Already initialized, skipping')
    return
  }

  try {
    console.log('[CronScheduler] Initializing cron jobs...')

    const jobDaily = cron.schedule('0 8 * * 1-5', () => {
      console.log('[CronScheduler] Weekday 8:00 AM VN — triggering daily digest')
      runDailyDigest()
        .then(result => console.log('[CronScheduler] Daily digest sent:', JSON.stringify(result)))
        .catch(err => console.error('[CronScheduler] Daily digest failed:', err))
    }, { timezone: 'Asia/Ho_Chi_Minh' })

    initialized = true
    console.log('[CronScheduler] Started successfully — 8:00 Mon-Fri Asia/Ho_Chi_Minh')
    console.log('[CronScheduler] Jobs registered:', { 'daily8am': !!jobDaily })
  } catch (err) {
    console.error('[CronScheduler] Failed to initialize:', err)
  }
}
