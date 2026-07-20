import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { checkDeadlines } from '@/lib/task-engine'

// GET /api/cron/deadline-check — sinh thông báo "việc quá hạn" cho người phụ trách.
// Idempotent trong ngày: không nhắc lại việc đã có thông báo quá hạn chưa đọc.
//
// Bảo vệ: khi biến CRON_SECRET được cấu hình, endpoint YÊU CẦU khớp secret
// (header `Authorization: Bearer <CRON_SECRET>` hoặc tham số `?secret=<CRON_SECRET>`),
// sai/thiếu → 401. Khi chưa cấu hình (vd local dev) thì để mở để tiện kiểm thử.
// Lịch in-process (cron-scheduler) gọi thẳng checkDeadlines() nên KHÔNG đi qua guard này.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const provided = bearer || req.nextUrl.searchParams.get('secret') || ''
    if (provided !== secret) return errorResponse('Unauthorized', 401)
  }
  try {
    const notified = await checkDeadlines()
    return successResponse({ notified })
  } catch (err) {
    console.error('GET /api/cron/deadline-check error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
