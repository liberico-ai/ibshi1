import { successResponse, errorResponse } from '@/lib/auth'
import { runCustomerSync } from '@/lib/cron-jobs'

export async function GET() {
  try {
    const result = await runCustomerSync()
    return successResponse(result)
  } catch (err) {
    console.error('GET /api/cron/sync-customers error:', err)
    const msg = err instanceof Error ? err.message : 'Lỗi hệ thống'
    const status = (err as { status?: number }).status || 500
    return errorResponse(msg, status)
  }
}
