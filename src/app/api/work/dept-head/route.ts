import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getDeptHead } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/dept-head?role=R01 — trả trưởng phòng của role (để giao cấp phòng tự gắn người).
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const role = new URL(req.url).searchParams.get('role')?.trim()
    if (!role) return successResponse({ head: null })
    const head = await getDeptHead(role)
    return successResponse({ head })
  } catch (err) {
    console.error('GET /api/work/dept-head error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
