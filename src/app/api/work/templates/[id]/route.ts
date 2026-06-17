import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getTemplate } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// GET /api/work/templates/[id] — chi tiết template + các bước
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const template = await getTemplate(id)
    if (!template) return errorResponse('Không tìm thấy template', 404)
    return successResponse({ template })
  } catch (err) {
    console.error('GET /api/work/templates/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
