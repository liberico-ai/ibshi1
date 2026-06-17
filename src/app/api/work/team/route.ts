import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getDeptWorkload } from '@/lib/work-analytics'

export const dynamic = 'force-dynamic'

// GET /api/work/team — bảng việc của phòng người gọi (trưởng phòng xem nhân sự phòng mình đang làm gì).
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const data = await getDeptWorkload(payload.roleCode)
    return successResponse(data)
  } catch (err) {
    console.error('GET /api/work/team error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
