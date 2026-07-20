import { successResponse, errorResponse } from '@/lib/auth'
import { checkDeadlines } from '@/lib/task-engine'

// GET /api/cron/deadline-check — sinh thông báo "việc quá hạn" cho người phụ trách.
// Idempotent trong ngày: không nhắc lại việc đã có thông báo quá hạn chưa đọc.
export async function GET() {
  try {
    const notified = await checkDeadlines()
    return successResponse({ notified })
  } catch (err) {
    console.error('GET /api/cron/deadline-check error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
