import { successResponse, errorResponse } from '@/lib/auth'
import { checkDeadlines } from '@/lib/task-engine'

// GET /api/cron/deadline-check — sinh thông báo "việc quá hạn" cho người phụ trách.
// Idempotent trong ngày: không nhắc lại việc đã có thông báo quá hạn chưa đọc.
//
// Bảo vệ: middleware chặn toàn bộ /api/cron/* — yêu cầu header `x-cron-secret` khớp CRON_SECRET
// (CRON_SECRET chưa cấu hình → mọi /api/cron/* trả 401). Lịch in-process gọi thẳng checkDeadlines().
export async function GET() {
  try {
    const notified = await checkDeadlines()
    return successResponse({ notified })
  } catch (err) {
    console.error('GET /api/cron/deadline-check error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
