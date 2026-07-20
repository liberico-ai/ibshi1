import cron from 'node-cron'
import { runDailyDigest, runCustomerSync } from '@/lib/cron-jobs'
import { checkDeadlines } from '@/lib/task-engine'

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

    const jobSync = cron.schedule('*/15 * * * *', () => {
      console.log('[CronScheduler] Every 15min — triggering customer sync')
      runCustomerSync()
        .then(r => console.log('[CronScheduler] Customer sync:', JSON.stringify(r)))
        .catch(err => console.error('[CronScheduler] Customer sync failed:', err))
    }, { timezone: 'Asia/Ho_Chi_Minh' })

    // Nhắc việc quá hạn: mỗi sáng thứ 2–6, 8:05 (ngay sau digest). Sinh thông báo in-app
    // cho người phụ trách; idempotent nên chạy lại không spam.
    const jobDeadline = cron.schedule('5 8 * * 1-5', () => {
      console.log('[CronScheduler] Weekday 8:05 AM VN — checking overdue tasks')
      checkDeadlines()
        .then(n => console.log(`[CronScheduler] Deadline check: ${n} thông báo quá hạn mới`))
        .catch(err => console.error('[CronScheduler] Deadline check failed:', err))
    }, { timezone: 'Asia/Ho_Chi_Minh' })

    initialized = true
    console.log('[CronScheduler] Started successfully')
    console.log('[CronScheduler] Jobs registered:', { 'daily8am': !!jobDaily, 'sync15min': !!jobSync, 'deadline805am': !!jobDeadline })
  } catch (err) {
    console.error('[CronScheduler] Failed to initialize:', err)
  }
}
