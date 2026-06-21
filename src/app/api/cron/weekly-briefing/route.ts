import { successResponse, errorResponse } from '@/lib/auth'
import { runWeeklyBriefingDigest } from '@/lib/cron-jobs'

export async function GET() {
  try {
    const result = await runWeeklyBriefingDigest()
    return successResponse(result)
  } catch (err) {
    console.error('GET /api/cron/weekly-briefing error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
