import { successResponse, errorResponse } from '@/lib/auth'
import { runDailyDigest } from '@/lib/cron-jobs'

export async function GET() {
  try {
    const result = await runDailyDigest()
    return successResponse(result)
  } catch (err) {
    console.error('GET /api/cron/daily-digest error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
