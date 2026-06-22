import { successResponse, errorResponse } from '@/lib/auth'
import { runDailyDeadlineDigest } from '@/lib/cron-jobs'

export async function GET() {
  try {
    const result = await runDailyDeadlineDigest()
    return successResponse(result)
  } catch (err) {
    console.error('GET /api/cron/daily-deadline error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
