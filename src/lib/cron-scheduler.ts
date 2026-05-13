import cron from 'node-cron'
import { runProjectStatusReport } from '@/lib/cron-jobs'

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

    initialized = true
    console.log('[CronScheduler] ✅ Started successfully')
    console.log('[CronScheduler] Schedule: 9:00 & 17:00 Asia/Ho_Chi_Minh')
    console.log('[CronScheduler] Jobs registered:', { '9am': !!job9am, '5pm': !!job5pm })
  } catch (err) {
    console.error('[CronScheduler] ❌ Failed to initialize:', err)
  }
}
