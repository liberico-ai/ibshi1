import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getDeptUsers } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/dept-users?role=R01 — nhân sự của phòng (để "mời cả phòng" khi tạo họp)
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const role = new URL(req.url).searchParams.get('role')?.trim()
    if (!role) return successResponse({ users: [] })
    const users = await getDeptUsers(role)
    return successResponse({ users })
  } catch (err) {
    console.error('GET /api/work/dept-users error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
