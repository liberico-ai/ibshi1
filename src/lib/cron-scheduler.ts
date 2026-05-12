import cron from 'node-cron'

let initialized = false

export function isSchedulerRunning() {
  return initialized
}

export function startScheduler() {
  if (initialized) return

  // 9:00 sáng giờ VN (UTC+7) = 2:00 UTC
  cron.schedule('0 2 * * *', () => {
    triggerProjectStatusReport()
  }, { timezone: 'Asia/Ho_Chi_Minh' })

  // 17:00 chiều giờ VN (UTC+7) = 10:00 UTC
  cron.schedule('0 10 * * *', () => {
    triggerProjectStatusReport()
  }, { timezone: 'Asia/Ho_Chi_Minh' })

  initialized = true
  console.log('[CronScheduler] Started — project status report at 9:00 & 17:00 VN time')
}

async function triggerProjectStatusReport() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const res = await fetch(`${baseUrl}/api/cron/project-status-report`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET || '' }
    })
    const data = await res.json()
    console.log('[CronScheduler] Project status report sent:', data)
  } catch (err) {
    console.error('[CronScheduler] Failed to send project status report:', err)
  }
}
