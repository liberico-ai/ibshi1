import cron from 'node-cron'
import { runProjectStatusReport } from '@/lib/cron-jobs'

let initialized = false

export function isSchedulerRunning() {
  return initialized
}

export function startScheduler() {
  if (initialized) return

  cron.schedule('0 9 * * *', () => {
    runProjectStatusReport().catch(err =>
      console.error('[CronScheduler] Project status report failed:', err)
    )
  }, { timezone: 'Asia/Ho_Chi_Minh' })

  cron.schedule('0 17 * * *', () => {
    runProjectStatusReport().catch(err =>
      console.error('[CronScheduler] Project status report failed:', err)
    )
  }, { timezone: 'Asia/Ho_Chi_Minh' })

  initialized = true
  console.log('[CronScheduler] Started — project status report at 9:00 & 17:00 VN time')
}
