import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { runDailyDeadlineDigest } from '@/lib/cron-jobs'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!['R01', 'R02', 'R10'].includes(payload.roleCode)) return forbiddenResponse('Chỉ BGĐ/PM/Admin')

    const result = await runDailyDeadlineDigest()
    return successResponse(result)
  } catch (err) {
    console.error('GET /api/work/briefing/test-digest error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
