import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { purgeOldLogs } from '@/lib/log-retention'

// GET /api/cron/log-retention — xóa log (Nhật ký + Error Logs) quá hạn lưu trữ.
// Thêm ?dryRun=1 để chỉ ĐẾM số bản ghi sẽ xóa (không xóa) — dùng xem trước.
//
// Bảo vệ: middleware chặn toàn bộ /api/cron/* — yêu cầu header `x-cron-secret` khớp CRON_SECRET
// (CRON_SECRET chưa cấu hình → mọi /api/cron/* trả 401). Lịch in-process gọi thẳng purgeOldLogs().
export async function GET(req: NextRequest) {
  try {
    const dryRun = ['1', 'true'].includes(req.nextUrl.searchParams.get('dryRun') || '')
    const result = await purgeOldLogs({ dryRun })
    return successResponse({ ...result })
  } catch (err) {
    console.error('GET /api/cron/log-retention error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
