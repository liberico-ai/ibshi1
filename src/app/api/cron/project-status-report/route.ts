import { successResponse, errorResponse } from '@/lib/auth'
import { runProjectStatusReport } from '@/lib/cron-jobs'

export async function GET() {
  try {
    const result = await runProjectStatusReport()
    return successResponse(result)
  } catch (err) {
    console.error('GET /api/cron/project-status-report error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
