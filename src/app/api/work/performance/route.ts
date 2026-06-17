import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getPerformance } from '@/lib/work-analytics'

export const dynamic = 'force-dynamic'

// GET /api/work/performance?from=&to= — KPI hiệu suất theo phòng ban
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const sp = new URL(req.url).searchParams
    const from = sp.get('from') ? new Date(sp.get('from')!) : undefined
    const to = sp.get('to') ? new Date(sp.get('to')!) : undefined
    const data = await getPerformance(from, to)
    return successResponse(data)
  } catch (err) {
    console.error('GET /api/work/performance error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
