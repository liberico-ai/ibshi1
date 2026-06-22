import cron from 'node-cron'
import { runProjectStatusReport, runWeeklyBriefingDigest, runDailyDeadlineDigest } from '@/lib/cron-jobs'

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

    const job9am = cron.schedule('0 9 * * *', () => {
      console.log('[CronScheduler] 9:00 AM VN — triggering project status report')
      runProjectStatusReport()
        .then(result => console.log('[CronScheduler] 9AM report sent:', JSON.stringify(result)))
        .catch(err => console.error('[CronScheduler] 9AM report failed:', err))
    }, { timezone: 'Asia/Ho_Chi_Minh' })

    const job5pm = cron.schedule('0 17 * * *', () => {
      console.log('[CronScheduler] 5:00 PM VN — triggering project status report')
      runProjectStatusReport()
        .then(result => console.log('[CronScheduler] 5PM report sent:', JSON.stringify(result)))
        .catch(err => console.error('[CronScheduler] 5PM report failed:', err))
    }, { timezone: 'Asia/Ho_Chi_Minh' })

    const jobMonday = cron.schedule('5 8 * * 1', () => {
      console.log('[CronScheduler] Monday 8:05 AM VN — triggering weekly briefing digest')
      runWeeklyBriefingDigest()
        .then(result => console.log('[CronScheduler] Weekly digest sent:', JSON.stringify(result)))
        .catch(err => console.error('[CronScheduler] Weekly digest failed:', err))
    }, { timezone: 'Asia/Ho_Chi_Minh' })

    const jobDaily = cron.schedule('0 8 * * 1-5', () => {
      console.log('[CronScheduler] Weekday 8:00 AM VN — triggering daily deadline digest')
      runDailyDeadlineDigest()
        .then(result => console.log('[CronScheduler] Daily deadline digest:', JSON.stringify(result)))
        .catch(err => console.error('[CronScheduler] Daily deadline digest failed:', err))
    }, { timezone: 'Asia/Ho_Chi_Minh' })

    initialized = true
    console.log('[CronScheduler] ✅ Started successfully')
    console.log('[CronScheduler] Schedule: 9:00 & 17:00 daily, 8:00 Mon-Fri (deadline), 8:05 Monday (weekly) Asia/Ho_Chi_Minh')
    console.log('[CronScheduler] Jobs registered:', { '9am': !!job9am, '5pm': !!job5pm, 'daily8am': !!jobDaily, 'monday805am': !!jobMonday })
  } catch (err) {
    console.error('[CronScheduler] ❌ Failed to initialize:', err)
  }
}
