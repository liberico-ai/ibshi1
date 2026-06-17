import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { listTemplates } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/templates — danh sách template quy trình
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const templates = await listTemplates()
    return successResponse({ templates })
  } catch (err) {
    console.error('GET /api/work/templates error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
